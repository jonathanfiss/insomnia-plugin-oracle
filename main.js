const oracledb = require('oracledb');
const express = require('express');
const bodyParser = require('body-parser');

// Configuração do servidor
const PORT = 3000;
const app = express();
app.use(bodyParser.json());

// Inicializa o cliente Oracle no modo thin
try {
    oracledb.initOracleClient({ driverType: oracledb.THIN });
} catch (err) {
    console.error('Failed to initialize Oracle Thin Mode:', err);
}

// Função para substituir binds no SQL (apenas para log)
function substituteBinds(sql, bindParams) {
    let debugSql = sql;
    for (const [key, value] of Object.entries(bindParams)) {
        const escapedValue = typeof value === 'string' ? `'${value.replace(/'/g, "''")}'` : value;
        debugSql = debugSql.replace(new RegExp(`:${key}\\b`, 'g'), escapedValue);
    }
    return debugSql;
}

// Função para executar queries genéricas
async function executeOracleOperation(user, password, connectString, sql, paramsJson) {
    const config = { user, password, connectString };
    let connection;

    try {

        // Parse seguro dos parâmetros
        const params = paramsJson ? JSON.parse(paramsJson) : {};

        // Configuração de execução
        const options = {
            outFormat: oracledb.OUT_FORMAT_OBJECT,
            autoCommit: true
        };

        connection = await oracledb.getConnection(config);

        // Identifica o tipo de operação
        const operationType = sql.trim().split(/\s+/)[0].toUpperCase();

        // Executa a operação
        const result = await connection.execute(sql, params, options);

        // Formata a resposta conforme o tipo de operação
        switch (operationType) {
            case 'SELECT':
                // Processa colunas RAW/BLOB para SELECT
                const processedRows = result.rows.map(row => {
                    const processedRow = {};
                    for (const [key, value] of Object.entries(row)) {
                        processedRow[key] = (value instanceof Buffer)
                            ? value.toString('hex').toUpperCase()
                            : value;
                    }
                    return processedRow;
                });
                return {
                    operation: 'SELECT',
                    rows: processedRows,
                    rowCount: result.rows.length
                };

            case 'INSERT':
            case 'UPDATE':
            case 'DELETE':
                return {
                    operation: operationType,
                    rowCount: result.rowsAffected,
                    message: `${result.rowsAffected} linha(s) afetada(s)`
                };

            default:
                return {
                    operation: operationType,
                    message: 'Operação executada com sucesso'
                };
        }

    } catch (err) {
        // Adiciona o SQL com binds substituídos ao erro
        err.debugSql = substituteBinds(sql, bindParams);
        throw err;
    } finally {
        // Fechamento seguro da conexão
        if (connection) {
            try {
                await connection.close();
            } catch (closeErr) {
                console.error('Erro ao fechar conexão:', closeErr);
            }
        }
    }
}

// Endpoint POST para executar queries
app.post('/query', async (req, res) => {
    try {
        const { user, password, connectString, sql, params } = req.body;

        if (!user || !password || !connectString || !sql) {
            return res.status(400).json({
                error: 'Parâmetros obrigatórios faltando: user, password, connectString, sql'
            });
        }

        const result = await executeOracleOperation(user, password, connectString, sql, params);
        res.json({ success: true, data: result });

    } catch (err) {
        res.status(500).json({
            success: false,
            debugSql: err.debugSql,
            originalSql: req.body.sql,
            bindParams: req.body.params,
            error: err.message,
            details: err.stack
        });
    }
});

// Endpoint GET para verificação
app.get('/status', (req, res) => {
    res.json({
        status: 'online',
        service: 'Oracle Query Endpoint',
        timestamp: new Date().toISOString(),
        features: ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'CALL']
    });
});

app.post('/echo', (req,res) => {
    res.json(req.body)
})

// Inicia o servidor
let server;
try {
    server = app.listen(PORT, () => {
        console.log(`Servidor Oracle Query rodando em http://localhost:${PORT}`);
        console.log(`Endpoint disponível: POST http://localhost:${PORT}/query`);
    });
} catch (err) {
    console.error('Erro ao iniciar servidor:', err);
}

// Mantém a funcionalidade original do plugin  com suporte a operações
module.exports.templateTags = [
    {
        name: 'oracle_operation',
        displayName: 'Oracle Operation',
        description: 'Executa operações SQL no Oracle (SELECT, INSERT, UPDATE, DELETE)',
        args: [
            {
                displayName: 'User',
                type: 'string',
                placeholder: 'Usuário do Oracle'
            },
            {
                displayName: 'Password',
                type: 'string',
                placeholder: 'Senha do Oracle'
            },
            {
                displayName: 'Connect String',
                type: 'string',
                placeholder: 'host:port/service_name'
            },
            {
                displayName: 'SQL',
                type: 'string',
                placeholder: 'SELECT * FROM tabela WHERE id = :id'
            }
            ,
            {
                displayName: 'Params (JSON)',
                type: 'string',
                placeholder: '{"id": 1}',
                optional: true
            }
        ],
        async run(context, user, password, connectString, sql, paramsJson = '{}') {
            const params = JSON.parse(paramsJson);
            const rows = await executeOracleOperation(user, password, connectString, sql, params);
            return JSON.stringify(rows, null, 2);
        }
    }
];

// Fecha o servidor quando o Insomnia é fechado
process.on('exit', () => {
    if (server) {
        server.close();
    }
});
