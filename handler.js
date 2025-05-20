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

const ORGANIZATIONS_TABLE = 'Organizations';
const USERS_TABLE = 'Users';

function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

module.exports.createOrganization = async (event) => {
    const { name, description } = JSON.parse(event.body);
    const orgId = uuidv4();

    const existingOrg = await dynamoDb.scan({
        TableName: ORGANIZATIONS_TABLE,
        FilterExpression: '#name = :val',
        ExpressionAttributeNames: { '#name': 'name' },
        ExpressionAttributeValues: { ':val': name },
    }).promise();

    if (existingOrg.Items.length > 0) {
        return {
            statusCode: 409,
            body: JSON.stringify({ error: 'Organization with this name already exists' }),
        };
    }

    await dynamoDb.put({
        TableName: ORGANIZATIONS_TABLE,
        Item: { orgId, name, description },
    }).promise();

    return {
        statusCode: 201,
        body: JSON.stringify({ message: 'Organization created', orgId }),
    };
};

module.exports.updateOrganization = async (event) => {
    const { orgId, name, description } = JSON.parse(event.body);

    const existing = await dynamoDb.get({
        TableName: ORGANIZATIONS_TABLE,
        Key: { orgId },
    }).promise();

    if (!existing.Item) {
        return {
            statusCode: 404,
            body: JSON.stringify({ error: 'Organization not found' }),
        };
    }

    if (existing.Item.name !== name) {
        const existingOrgWithName = await dynamoDb.scan({
            TableName: ORGANIZATIONS_TABLE,
            FilterExpression: '#name = :val',
            ExpressionAttributeNames: { '#name': 'name' },
            ExpressionAttributeValues: { ':val': name },
        }).promise();

        if (existingOrgWithName.Items.length > 0) {
            return {
                statusCode: 409,
                body: JSON.stringify({ error: 'Organization with this name already exists' }),
            };
        }
    }

    await dynamoDb.update({
        TableName: ORGANIZATIONS_TABLE,
        Key: { orgId },
        UpdateExpression: 'set #name = :n, description = :d',
        ExpressionAttributeNames: { '#name': 'name' },
        ExpressionAttributeValues: {
            ':n': name,
            ':d': description,
        },
    }).promise();

    return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Organization updated' }),
    };
};

module.exports.createUser = async (event) => {
    const { orgId } = event.pathParameters;
    const { name, email } = JSON.parse(event.body);
    const userId = uuidv4();

    if (!validateEmail(email)) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Invalid email format' }),
        };
    }

    const orgCheck = await dynamoDb.get({
        TableName: ORGANIZATIONS_TABLE,
        Key: { orgId },
    }).promise();

    if (!orgCheck.Item) {
        return {
            statusCode: 404,
            body: JSON.stringify({ error: 'Organization not found' }),
        };
    }

    const existingUser = await dynamoDb.scan({
        TableName: USERS_TABLE,
        FilterExpression: 'email = :emailVal',
        ExpressionAttributeValues: { ':emailVal': email },
    }).promise();

    if (existingUser.Items.length > 0) {
        return {
            statusCode: 409,
            body: JSON.stringify({ error: 'User with this email already exists' }),
        };
    }

    await dynamoDb.put({
        TableName: USERS_TABLE,
        Item: { userId, orgId, name, email },
    }).promise();

    return {
        statusCode: 201,
        body: JSON.stringify({ message: 'User registered', userId }),
    };
};

module.exports.updateUser = async (event) => {
    const { orgId } = event.pathParameters;
    const { userId, name, email } = JSON.parse(event.body);

    if (!validateEmail(email)) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Invalid email format' }),
        };
    }

    const existing = await dynamoDb.get({
        TableName: USERS_TABLE,
        Key: { userId },
    }).promise();

    if (!existing.Item) {
        return {
            statusCode: 404,
            body: JSON.stringify({ error: 'User not found' }),
        };
    }

    if (existing.Item.orgId !== orgId) {
        return {
            statusCode: 403,
            body: JSON.stringify({ error: 'User does not belong to this organization' }),
        };
    }

    if (existing.Item.email !== email) {
        const existingUserWithEmail = await dynamoDb.scan({
            TableName: USERS_TABLE,
            FilterExpression: 'email = :emailVal',
            ExpressionAttributeValues: { ':emailVal': email },
        }).promise();

        if (existingUserWithEmail.Items.length > 0) {
            return {
                statusCode: 409,
                body: JSON.stringify({ error: 'User with this email already exists' }),
            };
        }
    }
    await dynamoDb.update({
        TableName: USERS_TABLE,
        Key: { userId },
        UpdateExpression: 'set #name = :n, email = :e',
        ExpressionAttributeNames: { '#name': 'name' },
        ExpressionAttributeValues: {
            ':n': name,
            ':e': email,
        },
    }).promise();

    return {
        statusCode: 200,
        body: JSON.stringify({ message: 'User updated' }),
    };
};

module.exports.getOrganizations = async () => {
    const result = await dynamoDb.scan({ TableName: ORGANIZATIONS_TABLE }).promise();
    return {
        statusCode: 200,
        body: JSON.stringify(result.Items),
    };
};

module.exports.getUsers = async () => {
    const result = await dynamoDb.scan({ TableName: USERS_TABLE }).promise();
    return {
        statusCode: 200,
        body: JSON.stringify(result.Items),
    };
};

module.exports.getUsersByOrganization = async (event) => {
    const { orgId } = event.pathParameters;

    const result = await dynamoDb.scan({
        TableName: USERS_TABLE,
        FilterExpression: 'orgId = :orgIdVal',
        ExpressionAttributeValues: { ':orgIdVal': orgId },
    }).promise();

    return {
        statusCode: 200,
        body: JSON.stringify(result.Items),
    };
};