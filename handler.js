const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');


const isOffline = process.env.IS_OFFLINE === 'true';

const dynamoDb = isOffline
    ? new AWS.DynamoDB.DocumentClient({
        region: 'localhost',
        endpoint: 'http://localhost:8000',
        accessKeyId: 'fakeMyKeyId',
        secretAccessKey: 'fakeSecretAccessKey',
    })
    : new AWS.DynamoDB.DocumentClient();

// Налаштування SQS клієнта для локальної та хмарної роботи
const sqs = isOffline
    ? new AWS.SQS({
        region: 'localhost',
        endpoint: 'http://localhost:9324',
        accessKeyId: 'fakeMyKeyId',
        secretAccessKey: 'fakeSecretAccessKey',
    })
    : new AWS.SQS();


const ORGANIZATIONS_TABLE = process.env.ORGANIZATIONS_TABLE;
const USERS_TABLE = process.env.USERS_TABLE;

// URL черг з environment variables
const CREATE_ORGANIZATION_QUEUE_URL = process.env.CREATE_ORGANIZATION_QUEUE_URL;
const UPDATE_ORGANIZATION_QUEUE_URL = process.env.UPDATE_ORGANIZATION_QUEUE_URL;
const CREATE_USER_QUEUE_URL = process.env.CREATE_USER_QUEUE_URL;
const UPDATE_USER_QUEUE_URL = process.env.UPDATE_USER_QUEUE_URL;

function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}


module.exports.createOrganization = async (event) => {
    try {
        const { name, description } = JSON.parse(event.body);

        if (!name || !description) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Name and description are required' }),
                headers: { 'Content-Type': 'application/json' },
            };
        }

        const orgId = uuidv4();

        // Перевірка, чи існує організація з таким ім'ям
        const existingOrg = await dynamoDb.query({
            TableName: ORGANIZATIONS_TABLE,
            IndexName: 'NameIndex',
            KeyConditionExpression: '#name = :val',
            ExpressionAttributeNames: { '#name': 'name' },
            ExpressionAttributeValues: { ':val': name },
        }).promise();

        if (existingOrg.Items && existingOrg.Items.length > 0) {
            return {
                statusCode: 409,
                body: JSON.stringify({ error: 'Organization with this name already exists' }),
                headers: { 'Content-Type': 'application/json' },
            };
        }

        // Відправлення повідомлення в SQS для асинхронної обробки
        await sqs.sendMessage({
            QueueUrl: CREATE_ORGANIZATION_QUEUE_URL,
            MessageBody: JSON.stringify({ orgId, name, description }),
        }).promise();

        return {
            statusCode: 202,
            body: JSON.stringify({ message: 'Organization creation initiated', orgId }),
            headers: { 'Content-Type': 'application/json' },
        };
    } catch (error) {
        console.error('Error in createOrganization handler:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to initiate organization creation', details: error.message }),
            headers: { 'Content-Type': 'application/json' },
        };
    }
};

module.exports.updateOrganization = async (event) => {
    try {
        const { orgId } = event.pathParameters;
        const { name, description } = JSON.parse(event.body);

        if (!name || !description) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Name and description are required' }),
                headers: { 'Content-Type': 'application/json' },
            };
        }

        // Перевірка існування організації
        const existingOrg = await dynamoDb.get({
            TableName: ORGANIZATIONS_TABLE,
            Key: { orgId },
        }).promise();

        if (!existingOrg.Item) {
            return {
                statusCode: 404,
                body: JSON.stringify({ error: 'Organization not found' }),
                headers: { 'Content-Type': 'application/json' },
            };
        }

        // Якщо назва змінюється, перевіряємо на унікальність нової назви
        if (existingOrg.Item.name !== name) {
            const orgWithNewName = await dynamoDb.query({
                TableName: ORGANIZATIONS_TABLE,
                IndexName: 'NameIndex',
                KeyConditionExpression: '#name = :val',
                ExpressionAttributeNames: { '#name': 'name' },
                ExpressionAttributeValues: { ':val': name },
            }).promise();

            // Перевіряємо, чи існує організація з таким ім'ям, яка не є поточною
            if (orgWithNewName.Items && orgWithNewName.Items.length > 0 && orgWithNewName.Items[0].orgId !== orgId) {
                return {
                    statusCode: 409,
                    body: JSON.stringify({ error: 'Organization with this name already exists' }),
                    headers: { 'Content-Type': 'application/json' },
                };
            }
        }

        // Відправлення повідомлення в SQS
        await sqs.sendMessage({
            QueueUrl: UPDATE_ORGANIZATION_QUEUE_URL,
            MessageBody: JSON.stringify({ orgId, name, description }),
        }).promise();

        return {
            statusCode: 202,
            body: JSON.stringify({ message: 'Organization update initiated' }),
            headers: { 'Content-Type': 'application/json' },
        };
    } catch (error) {
        console.error('Error in updateOrganization handler:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to initiate organization update', details: error.message }),
            headers: { 'Content-Type': 'application/json' },
        };
    }
};

module.exports.createUser = async (event) => {
    try {
        const { orgId } = event.pathParameters;
        const { name, email } = JSON.parse(event.body);
        const userId = uuidv4();

        if (!name || !email) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Name and email are required' }),
                headers: { 'Content-Type': 'application/json' },
            };
        }

        if (!validateEmail(email)) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Invalid email format' }),
                headers: { 'Content-Type': 'application/json' },
            };
        }

        // Перевірка існування організації
        const orgCheck = await dynamoDb.get({
            TableName: ORGANIZATIONS_TABLE,
            Key: { orgId },
        }).promise();

        if (!orgCheck.Item) {
            return {
                statusCode: 404,
                body: JSON.stringify({ error: 'Organization not found' }),
                headers: { 'Content-Type': 'application/json' },
            };
        }

        // Перевірка, чи існує користувач з таким email
        const existingUser = await dynamoDb.query({
            TableName: USERS_TABLE,
            IndexName: 'EmailIndex', // Використовуємо GSI
            KeyConditionExpression: 'email = :emailVal',
            ExpressionAttributeValues: { ':emailVal': email },
        }).promise();

        if (existingUser.Items && existingUser.Items.length > 0) {
            return {
                statusCode: 409,
                body: JSON.stringify({ error: 'User with this email already exists' }),
                headers: { 'Content-Type': 'application/json' },
            };
        }

        // Відправлення повідомлення в SQS
        await sqs.sendMessage({
            QueueUrl: CREATE_USER_QUEUE_URL,
            MessageBody: JSON.stringify({ userId, orgId, name, email }),
        }).promise();

        return {
            statusCode: 202,
            body: JSON.stringify({ message: 'User registration initiated', userId }),
            headers: { 'Content-Type': 'application/json' },
        };
    } catch (error) {
        console.error('Error in createUser handler:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to initiate user registration', details: error.message }),
            headers: { 'Content-Type': 'application/json' },
        };
    }
};

module.exports.updateUser = async (event) => {
    try {
        const { orgId, userId } = event.pathParameters;
        const { name, email } = JSON.parse(event.body);

        if (!name || !email) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Name and email are required' }),
                headers: { 'Content-Type': 'application/json' },
            };
        }

        if (!validateEmail(email)) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Invalid email format' }),
                headers: { 'Content-Type': 'application/json' },
            };
        }

        // Перевірка існування користувача
        const existingUser = await dynamoDb.get({
            TableName: USERS_TABLE,
            Key: { userId },
        }).promise();

        if (!existingUser.Item) {
            return {
                statusCode: 404,
                body: JSON.stringify({ error: 'User not found' }),
                headers: { 'Content-Type': 'application/json' },
            };
        }

        // Перевірка приналежності користувача до організації
        if (existingUser.Item.orgId !== orgId) {
            return {
                statusCode: 403,
                body: JSON.stringify({ error: 'User does not belong to this organization' }),
                headers: { 'Content-Type': 'application/json' },
            };
        }

        // Якщо email змінюється, перевіряємо на унікальність нового email
        if (existingUser.Item.email !== email) {
            const userWithNewEmail = await dynamoDb.query({
                TableName: USERS_TABLE,
                IndexName: 'EmailIndex',
                KeyConditionExpression: 'email = :emailVal',
                ExpressionAttributeValues: { ':emailVal': email },
            }).promise();

            // Якщо знайшли користувача з таким email і це не поточний користувач
            if (userWithNewEmail.Items && userWithNewEmail.Items.length > 0 && userWithNewEmail.Items[0].userId !== userId) {
                return {
                    statusCode: 409,
                    body: JSON.stringify({ error: 'User with this email already exists' }),
                    headers: { 'Content-Type': 'application/json' },
                };
            }
        }

        // Відправлення повідомлення в SQS
        await sqs.sendMessage({
            QueueUrl: UPDATE_USER_QUEUE_URL,
            MessageBody: JSON.stringify({ userId, name, email }),
        }).promise();

        return {
            statusCode: 202,
            body: JSON.stringify({ message: 'User update initiated' }),
            headers: { 'Content-Type': 'application/json' },
        };
    } catch (error) {
        console.error('Error in updateUser handler:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to initiate user update', details: error.message }),
            headers: { 'Content-Type': 'application/json' },
        };
    }
};

//SQS-обробники (записують дані в DynamoDB)
module.exports.processCreateOrganization = async (event) => {
    for (const record of event.Records) {
        try {
            const { orgId, name, description } = JSON.parse(record.body);

            await dynamoDb.put({
                TableName: ORGANIZATIONS_TABLE,
                Item: { orgId, name, description },
            }).promise();

            console.log(`[SQS] Successfully created organization: ${orgId}`);
        } catch (error) {
            console.error('[SQS] Error processing createOrganization message:', error);
            throw error;
        }
    }
    return { statusCode: 200 };
};

module.exports.processUpdateOrganization = async (event) => {
    for (const record of event.Records) {
        try {
            const { orgId, name, description } = JSON.parse(record.body);
            const updateParams = {
                TableName: ORGANIZATIONS_TABLE,
                Key: { orgId },
                UpdateExpression: 'set #name = :n, description = :d',
                ExpressionAttributeNames: { '#name': 'name' },
                ExpressionAttributeValues: {
                    ':n': name,
                    ':d': description,
                },
            };

            await dynamoDb.update(updateParams).promise();

            console.log(`[SQS] Successfully updated organization: ${orgId}`);
        } catch (error) {
            console.error('[SQS] Error processing updateOrganization message:', error);
            throw error;
        }
    }
    return { statusCode: 200 };
};

module.exports.processCreateUser = async (event) => {
    for (const record of event.Records) {
        try {
            const { userId, orgId, name, email } = JSON.parse(record.body);

            await dynamoDb.put({
                TableName: USERS_TABLE,
                Item: { userId, orgId, name, email },
            }).promise();

            console.log(`[SQS] Successfully created user: ${userId} in organization: ${orgId}`);
        } catch (error) {
            console.error('[SQS] Error processing createUser message:', error);
            throw error;
        }
    }
    return { statusCode: 200 };
};

module.exports.processUpdateUser = async (event) => {
    for (const record of event.Records) {
        try {
            const { userId, name, email } = JSON.parse(record.body);

            const updateParams = {
                TableName: USERS_TABLE,
                Key: { userId },
                UpdateExpression: 'set #name = :n, email = :e',
                ExpressionAttributeNames: { '#name': 'name' },
                ExpressionAttributeValues: {
                    ':n': name,
                    ':e': email,
                },
            };

            await dynamoDb.update(updateParams).promise();

            console.log(`[SQS] Successfully updated user: ${userId}`);
        } catch (error) {
            console.error('[SQS] Error processing updateUser message:', error);
            throw error;
        }
    }
    return { statusCode: 200 };
};

//Функції отримання даних з dynamodb

module.exports.getOrganizations = async () => {
    try {
        const result = await dynamoDb.scan({ TableName: ORGANIZATIONS_TABLE }).promise();
        return {
            statusCode: 200,
            body: JSON.stringify(result.Items),
            headers: { 'Content-Type': 'application/json' },
        };
    } catch (error) {
        console.error('Error in getOrganizations handler:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to retrieve organizations', details: error.message }),
            headers: { 'Content-Type': 'application/json' },
        };
    }
};

module.exports.getUsers = async () => {
    try {
        const result = await dynamoDb.scan({ TableName: USERS_TABLE }).promise();
        return {
            statusCode: 200,
            body: JSON.stringify(result.Items),
            headers: { 'Content-Type': 'application/json' },
        };
    } catch (error) {
        console.error('Error in getUsers handler:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to retrieve users', details: error.message }),
            headers: { 'Content-Type': 'application/json' },
        };
    }
};

module.exports.getUsersByOrganization = async (event) => {
    try {
        const { orgId } = event.pathParameters;

        // Перевірка існування організації
        const orgCheck = await dynamoDb.get({
            TableName: ORGANIZATIONS_TABLE,
            Key: { orgId },
        }).promise();

        if (!orgCheck.Item) {
            return {
                statusCode: 404,
                body: JSON.stringify({ error: 'Organization not found' }),
                headers: { 'Content-Type': 'application/json' },
            };
        }

        const result = await dynamoDb.query({
            TableName: USERS_TABLE,
            IndexName: 'OrgIdIndex',
            KeyConditionExpression: 'orgId = :orgIdVal',
            ExpressionAttributeValues: { ':orgIdVal': orgId },
        }).promise();

        return {
            statusCode: 200,
            body: JSON.stringify(result.Items),
            headers: { 'Content-Type': 'application/json' },
        };
    } catch (error) {
        console.error('Error in getUsersByOrganization handler:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to retrieve users by organization', details: error.message }),
            headers: { 'Content-Type': 'application/json' },
        };
    }
};