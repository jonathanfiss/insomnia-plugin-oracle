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

// Função para executar queries
async function executeOracleQuery(user, password, connectString, query) {
    const config = { user, password, connectString };
    let connection;

    try {
        connection = await oracledb.getConnection(config);
        const result = await connection.execute(query, [], {
            outFormat: oracledb.OUT_FORMAT_OBJECT,
            fetchInfo: {
                "RAW_COLUMN": { type: oracledb.BUFFER }, // Força como Buffer
                "BLOB_COLUMN": { type: oracledb.STRING } // Converte para string
            }
        });

        // Processa as colunas RAW
        const processedRows = result.rows.map(row => {
            const processedRow = {};
            for (const [key, value] of Object.entries(row)) {
                if (value instanceof Buffer) {
                    // Converte RAW para hexadecimal
                    processedRow[key] = value.toString('hex').toUpperCase();
                } else {
                    processedRow[key] = value;
                }
            }
            return processedRow;
        });
        return processedRows;

    } finally {
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
        const { user, password, connectString, query } = req.body;

        if (!user || !password || !connectString || !query) {
            return res.status(400).json({
                error: 'Parâmetros obrigatórios faltando: user, password, connectString, query'
            });
        }

        const result = await executeOracleQuery(user, password, connectString, query);
        res.json({ success: true, data: result });

    } catch (err) {
        res.status(500).json({
            success: false,
            query: req.body.query,
            error: err.message,
            details: err.stack
        });
    }
});

// Endpoint GET simples para teste
app.get('/status', (req, res) => {
    res.json({
        status: 'online',
        service: 'Oracle Query Endpoint',
        timestamp: new Date().toISOString()
    });
});

// Inicia o servidor quando o plugin é carregado
let server;
try {
    server = app.listen(PORT, () => {
        console.log(`Servidor Oracle Query rodando em http://localhost:${PORT}`);
        console.log(`Endpoint disponível: POST http://localhost:${PORT}/query`);
    });
} catch (err) {
    console.error('Erro ao iniciar servidor:', err);
}

// Mantém a funcionalidade original do plugin
module.exports.templateTags = [
    {
        name: 'oracle_query',
        displayName: 'Oracle Query',
        description: 'Executa uma consulta SELECT no Oracle e retorna JSON',
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
                displayName: 'Query',
                type: 'string',
                placeholder: 'SELECT * FROM tabela'
            }
        ],
        async run(context, user, password, connectString, query) {
            const rows = await executeOracleQuery(user, password, connectString, query);
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