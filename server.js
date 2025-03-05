require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Add a user session state (in production, you'd use a proper session store)
const userSessions = {};

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// New endpoint to set user identity for RLS
app.post('/api/set-user-identity', async (req, res) => {
    try {
        const { username, roles = [], customData = {} } = req.body;
        
        if (!username) {
            return res.status(400).json({ error: 'Username is required' });
        }
        
        // Generate a session ID (in production, use a proper session management system)
        const sessionId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        
        // Store user identity with session
        userSessions[sessionId] = {
            username,
            roles,
            customData,
            timestamp: new Date()
        };
        
        // Return session info
        return res.json({
            sessionId,
            message: `Identity set for user: ${username}`,
            roles: roles,
            customData: customData
        });
    } catch (error) {
        console.error('Error setting user identity:', error);
        return res.status(500).json({
            error: 'Failed to set user identity',
            details: error.message
        });
    }
});

// Endpoint to get current RLS identity
app.get('/api/current-identity', (req, res) => {
    const { sessionId } = req.query;
    
    if (!sessionId || !userSessions[sessionId]) {
        return res.json({
            authenticated: false,
            message: 'No active identity session'
        });
    }
    
    const session = userSessions[sessionId];
    return res.json({
        authenticated: true,
        username: session.username,
        roles: session.roles,
        customData: session.customData
    });
});

// Azure OpenAI API endpoint - Modified to query Power BI semantic model
app.post('/api/chat', async (req, res) => {
    try {
        const { message, sessionId } = req.body;
       
        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        // Check if Azure OpenAI credentials are set
        if (!process.env.AZURE_OPENAI_API_KEY || 
            !process.env.AZURE_OPENAI_ENDPOINT || 
            !process.env.AZURE_OPENAI_DEPLOYMENT_NAME) {
            return res.status(500).json({
                error: 'Azure OpenAI credentials are not configured',
                details: 'Please set AZURE_OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT, and AZURE_OPENAI_DEPLOYMENT_NAME in your .env file'
            });
        }

        // Check if Power BI credentials are configured for semantic model
        const isPBIConfigured = process.env.POWERBI_CLIENT_ID &&
                               process.env.POWERBI_CLIENT_SECRET &&
                               process.env.POWERBI_TENANT_ID &&
                               process.env.POWERBI_WORKSPACE_ID &&
                               process.env.POWERBI_DATASET_ID;

        if (!isPBIConfigured) {
            // If Power BI not configured, fall back to standard OpenAI chat
            console.log("Power BI semantic model not configured. Falling back to standard chat.");
            return handleStandardChat(message, res);
        }
        
        console.log("Using Power BI semantic model integration for:", message);
        
        // Get RLS identity info
        const userIdentity = sessionId && userSessions[sessionId] ? userSessions[sessionId] : null;
        
        // If using RLS, log the active user
        if (userIdentity) {
            console.log(`Query running with RLS identity: ${userIdentity.username}`);
        } else {
            console.log("Query running without RLS identity");
        }

        // Step 1: First, use Azure OpenAI to convert natural language to DAX query
        try {
            // Detect if this is a visualization request
            const isVisualizationRequest = message.toLowerCase().includes('chart') || 
                                         message.toLowerCase().includes('graph') || 
                                         message.toLowerCase().includes('plot') || 
                                         message.toLowerCase().includes('compare') || 
                                         message.toLowerCase().includes('trend') || 
                                         message.toLowerCase().includes('visualization') ||
                                         message.toLowerCase().includes('show me');
            
            // Use Azure OpenAI API without any data_sources parameter
            const daxQueryResponse = await axios({
                method: 'POST',
                url: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT_NAME}/chat/completions?api-version=2024-02-15-preview`,
                headers: {
                    'Content-Type': 'application/json',
                    'api-key': process.env.AZURE_OPENAI_API_KEY
                },
                data: {
                    messages: [
                        {
                            role: "system",
                            content: `You are a DAX query generator for Power BI semantic models. 
                            Convert natural language to DAX queries. Output only the DAX query without explanation.
                            ${isVisualizationRequest ? 'Since the user is asking for a visualization, make sure to return data suitable for charting with appropriate dimensions and measures.' : ''}
                            The dataset contains a table called "sales" with these columns: CustomerName, EmailAddress, TaxAmount, Quantity, OrderDate, SalesOrderLineNumber, SalesOrderNumber, UnitPrice, Item. Use these exact column names in your queries.
                            For example, if the user asks "What were the total sales last year?", 
                            you might output: "EVALUATE ROW(\"Total Sales\", CALCULATE(SUM(sales[UnitPrice] * sales[Quantity]), sales[OrderDate] >= DATE(YEAR(TODAY())-1, 1, 1) && sales[OrderDate] <= DATE(YEAR(TODAY())-1, 12, 31)))".
                            For visualization requests like "Show me sales by month", output something like: 
                            "EVALUATE SUMMARIZECOLUMNS(MONTH(sales[OrderDate]), \"Sales\", SUM(sales[UnitPrice] * sales[Quantity]))".
                            If you cannot generate a DAX query or the question is not data-related, respond with "NOT_DAX_QUERY".`
                        },
                        { role: "user", content: message }
                    ],
                    max_tokens: 800,
                    temperature: 0.3
                }
            });

            const daxContent = daxQueryResponse.data.choices[0].message.content.trim();
            console.log('Generated DAX query:', daxContent);

            // If the AI says it's not a DAX query, handle as a standard chat
            if (daxContent === "NOT_DAX_QUERY") {
                return handleStandardChat(message, res);
            }
            
            // Validate and potentially fix the DAX query
            const validationResult = validateDaxQuery(daxContent);
            let finalDaxQuery = daxContent;
            
            if (!validationResult.valid) {
                console.log('DAX validation failed:', validationResult.error);
                
                // If we have a fixed query suggestion, use it
                if (validationResult.fixedQuery) {
                    console.log('Using fixed DAX query:', validationResult.fixedQuery);
                    finalDaxQuery = validationResult.fixedQuery;
                } else {
                    // If can't fix the query, try again with a clearer prompt
                    try {
                        const retryResponse = await axios({
                            method: 'POST',
                            url: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT_NAME}/chat/completions?api-version=2024-02-15-preview`,
                            headers: {
                                'Content-Type': 'application/json',
                                'api-key': process.env.AZURE_OPENAI_API_KEY
                            },
                            data: {
                                messages: [
                                    {
                                        role: "system",
                                        content: `You are a DAX query generator for Power BI. 
                                        Generate valid DAX queries following these rules:
                                        1. Always start with the EVALUATE keyword
                                        2. Use proper DAX syntax (no SQL-like syntax)
                                        3. Make sure all parentheses are balanced
                                        4. Use complete and valid DAX functions
                                        5. Output only the DAX query with no explanation
                                        6. If you cannot create a valid DAX query, respond with "NOT_DAX_QUERY"`
                                    },
                                    { 
                                        role: "user", 
                                        content: `The following DAX query has an error: ${daxContent}
                                        
                                        Error: ${validationResult.error}
                                        
                                        Please fix the query or generate a new one for: "${message}"` 
                                    }
                                ],
                                max_tokens: 800,
                                temperature: 0.3
                            }
                        });
                        
                        const fixedDaxContent = retryResponse.data.choices[0].message.content.trim();
                        console.log('Retry generated DAX query:', fixedDaxContent);
                        
                        if (fixedDaxContent !== "NOT_DAX_QUERY") {
                            // Validate the fixed query
                            const retryValidation = validateDaxQuery(fixedDaxContent);
                            if (retryValidation.valid) {
                                finalDaxQuery = retryValidation.query;
                            } else if (retryValidation.fixedQuery) {
                                finalDaxQuery = retryValidation.fixedQuery;
                            } else {
                                // If we still can't get a valid query, fall back to standard chat
                                return handleStandardChat(message, res, 
                                    "I couldn't generate a valid DAX query for your question. I'll try to answer with my general knowledge instead. ");
                            }
                        } else {
                            // If the retry also can't generate a DAX query, fall back to standard chat
                            return handleStandardChat(message, res);
                        }
                    } catch (retryError) {
                        console.error('Error retrying DAX query generation:', retryError.message);
                        return handleStandardChat(message, res, 
                            "I had trouble generating a valid DAX query. I'll answer with my general knowledge instead. ");
                    }
                }
            }

            // Step 2: Acquire AAD token for Power BI API
            const aadResponse = await axios({
                method: 'POST',
                url: `https://login.microsoftonline.com/${process.env.POWERBI_TENANT_ID}/oauth2/token`,
                data: new URLSearchParams({
                    grant_type: 'client_credentials',
                    client_id: process.env.POWERBI_CLIENT_ID,
                    client_secret: process.env.POWERBI_CLIENT_SECRET,
                    resource: 'https://analysis.windows.net/powerbi/api'
                }).toString(),
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });
            
            const aadToken = aadResponse.data.access_token;

            // Step 3: Execute DAX query against the Power BI dataset with RLS if applicable
            try {
                console.log('Executing DAX query:', finalDaxQuery);
                
                // Prepare query execution request
                const queryRequest = {
                    queries: [
                        {
                            query: finalDaxQuery
                        }
                    ],
                    serializerSettings: {
                        includeNulls: true
                    }
                };
                
                // Add effective identity for RLS if we have user identity
                if (userIdentity) {
                    queryRequest.impersonatedUserName = userIdentity.username;
                    
                    // Add roles if specified
                    if (userIdentity.roles && userIdentity.roles.length > 0) {
                        queryRequest.effectiveUserName = userIdentity.username;
                        queryRequest.roles = userIdentity.roles;
                    }
                    
                    // Add custom data if provided (can be used in RLS rules)
                    if (userIdentity.customData && Object.keys(userIdentity.customData).length > 0) {
                        queryRequest.identities = [
                            {
                                username: userIdentity.username,
                                roles: userIdentity.roles || [],
                                customData: userIdentity.customData
                            }
                        ];
                    }
                }
                
                // Execute query with RLS if applicable
                const queryResponse = await axios({
                    method: 'POST',
                    url: `https://api.powerbi.com/v1.0/myorg/groups/${process.env.POWERBI_WORKSPACE_ID}/datasets/${process.env.POWERBI_DATASET_ID}/executeQueries`,
                    headers: {
                        'Authorization': `Bearer ${aadToken}`,
                        'Content-Type': 'application/json'
                    },
                    data: queryRequest,
                    timeout: 15000
                });

                // Process query results and generate explanation
                console.log('Processing query results...');
                const queryResults = queryResponse.data.results[0];
                console.log('Query results:', JSON.stringify(queryResults, null, 2));
                
                // Determine chart type based on the query and user request
                let chartType = null;
                if (isVisualizationRequest) {
                    if (message.toLowerCase().includes('bar') || message.toLowerCase().includes('column')) {
                        chartType = 'bar';
                    } else if (message.toLowerCase().includes('line') || message.toLowerCase().includes('trend')) {
                        chartType = 'line';
                    } else if (message.toLowerCase().includes('pie') || message.toLowerCase().includes('distribution')) {
                        chartType = 'pie';
                    } else if (message.toLowerCase().includes('scatter')) {
                        chartType = 'scatter';
                    } else {
                        // Default chart type based on data structure
                        // If we have one category and one measure, default to bar chart
                        // If we have time series data, default to line chart
                        const results = queryResults.tables?.[0];
                        if (results && results.columns && results.columns.length > 0) {
                            if (results.columns.length === 2) {
                                chartType = 'bar';
                            } else if (results.columns.length > 2) {
                                // Check if first column might be a date/time dimension
                                const firstColumnName = results.columns[0].name.toLowerCase();
                                if (firstColumnName.includes('date') || 
                                    firstColumnName.includes('month') || 
                                    firstColumnName.includes('year') ||
                                    firstColumnName.includes('quarter')) {
                                    chartType = 'line';
                                } else {
                                    chartType = 'bar';
                                }
                            }
                        }
                    }
                }
                
                // Generate explanation for the results
                console.log('Generating explanation...');
                const summaryResponse = await axios({
                    method: 'POST',
                    url: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT_NAME}/chat/completions?api-version=2024-02-15-preview`,
                    headers: {
                        'Content-Type': 'application/json',
                        'api-key': process.env.AZURE_OPENAI_API_KEY
                    },
                    data: {
                        messages: [
                            {
                                role: "system",
                                content: `You are a data analyst explaining Power BI query results. 
                                The user asked: "${message}". 
                                The DAX query used was: "${finalDaxQuery}".
                                ${userIdentity ? `This data is filtered by row-level security for user: ${userIdentity.username}` : ''}
                                Based on the query results, provide a clear, concise explanation.
                                Also mention that this data comes from the Power BI semantic model.
                                ${userIdentity ? 'Mention that the data is filtered according to the user\'s security permissions.' : ''}`
                            },
                            { 
                                role: "user", 
                                content: `Here are the query results: ${JSON.stringify(queryResults, null, 2)}. Please explain these results in relation to the original question.` 
                            }
                        ],
                        max_tokens: 800,
                        temperature: 0.7
                    },
                    timeout: 15000
                });

                const explanation = summaryResponse.data.choices[0].message.content;
                
                // Return successful response with results
                return res.json({
                    response: explanation,
                    queryResults: queryResults,
                    daxQuery: finalDaxQuery,
                    isPowerBIData: true,
                    rlsApplied: !!userIdentity,
                    rlsUsername: userIdentity ? userIdentity.username : null,
                    chartType: chartType
                });
                
            } catch (queryError) {
                // Handle query execution errors
                console.error('Error executing query:', queryError.message);
                if (queryError.response?.data) {
                    console.error('Query error details:', JSON.stringify(queryError.response.data, null, 2));
                }
                
                // Extract detailed error information if available
                let errorDetails = "";
                try {
                    if (queryError.response?.data?.error?.['pbi.error']?.details &&
                        queryError.response?.data?.error?.['pbi.error']?.details.length > 0) {
                        errorDetails = queryError.response.data.error['pbi.error'].details[0].detail;
                        console.log('PBI Error details:', errorDetails);
                    }
                } catch (e) {
                    console.log('Error extracting PBI error details:', e);
                }
                
                // Default error response if query failed
                return res.json({
                    response: `I encountered difficulty querying your Power BI dataset. 
                    ${userIdentity ? `This may be related to row-level security restrictions for user ${userIdentity.username}.` : ''}
                    This might be because I don't have the right table or column names for your specific dataset.
                    Could you try asking in a different way or provide some information about what tables are available in your dataset?`,
                    isPowerBIData: false,
                    rlsApplied: !!userIdentity,
                    rlsUsername: userIdentity ? userIdentity.username : null
                });
            }

        } catch (error) {
            console.error('API Error:', error.response?.data || error.message);
            
            return handleStandardChat(message, res, 
                "I encountered an issue processing your question. I'll try to answer with my general knowledge instead. ");
        }
    } catch (error) {
        console.error('Server Error:', error.message);
        return res.status(500).json({
            error: 'Internal server error',
            details: error.message
        });
    }
});

// Helper function for standard chat without Power BI semantic model
async function handleStandardChat(message, res, prefix = "") {
    try {
        const systemMessage = "You are a helpful assistant.";
        
        // Standard chat completion without any search integration
        const apiData = {
            messages: [
                { role: "system", content: systemMessage },
                { role: "user", content: message }
            ],
            max_tokens: 800,
            temperature: 0.7
        };
        
        // Azure OpenAI API call
        const response = await axios({
            method: 'POST',
            url: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT_NAME}/chat/completions?api-version=2024-02-15-preview`,
            headers: {
                'Content-Type': 'application/json',
                'api-key': process.env.AZURE_OPENAI_API_KEY
            },
            data: apiData
        });

        // Extract the content from response
        const content = response.data.choices[0].message.content;
       
        // Return with prefix if provided
        return res.json({
            response: prefix + content,
            isPowerBIData: false
        });
    } catch (apiError) {
        console.error('Azure OpenAI API Error:', apiError.response?.data || apiError.message);
        
        return res.status(500).json({
            error: 'Failed to get response from Azure OpenAI',
            details: apiError.response?.data?.error?.message || apiError.message
        });
    }
}

// Endpoint to process Power BI filter and visualization requests
app.post('/api/pbi-filter', async (req, res) => {
    try {
        const { message, sessionId } = req.body;
       
        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        // Check if Azure OpenAI credentials are set
        if (!process.env.AZURE_OPENAI_API_KEY || 
            !process.env.AZURE_OPENAI_ENDPOINT || 
            !process.env.AZURE_OPENAI_DEPLOYMENT_NAME) {
            return res.status(500).json({
                filters: [],
                visualization: null,
                explanation: "Azure OpenAI credentials are not configured. Please add your keys to the .env file."
            });
        }

        // Detect if this is likely a visualization request
        const isVisualizationRequest = message.toLowerCase().includes('chart') || 
                                     message.toLowerCase().includes('graph') || 
                                     message.toLowerCase().includes('plot') || 
                                     message.toLowerCase().includes('compare') || 
                                     message.toLowerCase().includes('trend') || 
                                     message.toLowerCase().includes('visualization') ||
                                     message.toLowerCase().includes('show me') ||
                                     message.toLowerCase().includes('display') ||
                                     message.toLowerCase().includes('visual');

        // Use Azure OpenAI to convert natural language to filter and/or visualization
        try {
            const response = await axios({
                method: 'POST',
                url: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT_NAME}/chat/completions?api-version=2024-02-15-preview`,
                headers: {
                    'Content-Type': 'application/json',
                    'api-key': process.env.AZURE_OPENAI_API_KEY
                },
                data: {
                    messages: [
                        {
                            role: "system",
                            content: `You are a Power BI filter and visualization generator. Convert natural language to Power BI filter and visualization JSON.
                            
                            Here is the metadata: 
                            - Table name: sales
                            - Column names: CustomerName, EmailAddress, TaxAmount, Quantity, OrderDate, SalesOrderLineNumber, SalesOrderNumber, UnitPrice, Item
                            
                            Based on the input, determine if the user wants to:
                            1. Only apply a filter
                            2. Create a visualization
                            3. Both filter and visualize
                            
                            Output JSON with the following structure:
                            
                            {
                              "filters": [
                                {
                                  "table": "tableName",
                                  "column": "columnName",
                                  "operator": "In/Contains/Equals/etc",
                                  "values": ["value1", "value2"]
                                }
                              ],
                              "visualization": {
                                "type": "column/bar/line/pie/scatter/etc",
                                "dataRoles": [
                                  {
                                    "name": "category",
                                    "table": "tableName",
                                    "column": "columnName"
                                  },
                                  {
                                    "name": "value",
                                    "table": "tableName",
                                    "column": "columnName",
                                    "aggregation": "sum/count/average/etc"
                                  }
                                ],
                                "title": "Visualization title"
                              },
                              "explanation": "Human-readable explanation of the filter and/or visualization"
                            }
                           
                            For filter examples:
                            - "Show sales for last quarter" might output filter for OrderDate
                            - "Filter to high value items over $100" might output filter for UnitPrice > 100
                            
                            For visualization examples:
                            - "Show me sales by month" might create a column chart with OrderDate as category and Sum(UnitPrice * Quantity) as value
                            - "Create a pie chart of sales by product" might use Item as category and Sum(UnitPrice * Quantity) as value
                            
                            Set visualization to null if no visualization is requested.
                            Set filters to empty array if no filters are requested.
                            output format should be strictly JSON and should not include any other character enclosing.
                            If you can't understand the request, return {"filters": [], "visualization": null, "explanation": "I couldn't understand your request."}`
                        },
                        { role: "user", content: message }
                    ],
                    max_tokens: 800,
                    temperature: 0.5
                }
            });

            // Extract and parse the content from response
            const content = response.data.choices[0].message.content;
           
            // Try to parse the response as JSON
            try {
                const parsedData = JSON.parse(content);
                
                // For logging
                if (parsedData.visualization) {
                    console.log('Visualization request detected:', parsedData.visualization);
                }
                
                // Get RLS identity for DAX query if needed
                if (parsedData.visualization && sessionId && userSessions[sessionId]) {
                    parsedData.rlsUsername = userSessions[sessionId].username;
                }
                
                return res.json(parsedData);
            } catch (parseError) {
                console.error('Error parsing OpenAI response as JSON:', parseError);
                console.log('Raw response:', content);
                return res.json({
                    filters: [],
                    visualization: null,
                    explanation: "I received a response but couldn't parse it into a valid format. Please try again with a more specific request."
                });
            }
        } catch (apiError) {
            console.error('Azure OpenAI API Error:', apiError.response?.data || apiError.message);
           
            // Handle specific API errors
            if (apiError.response?.status === 401) {
                return res.json({
                    filters: [],
                    visualization: null,
                    explanation: "Authentication error with Azure OpenAI. Your API key may be invalid or expired."
                });
            } else if (apiError.response?.status === 404) {
                return res.json({
                    filters: [],
                    visualization: null,
                    explanation: "Azure OpenAI resource not found. Check your deployment name and endpoint URL."
                });
            } else {
                return res.json({
                    filters: [],
                    visualization: null,
                    explanation: "Error connecting to Azure OpenAI: " + (apiError.response?.data?.error?.message || apiError.message)
                });
            }
        }
    } catch (error) {
        console.error('Server Error:', error.message);
        return res.json({
            filters: [],
            visualization: null,
            explanation: "A server error occurred while processing your request: " + error.message
        });
    }
});

// Endpoint to get data for Power BI visualizations
app.post('/api/visualization-data', async (req, res) => {
    try {
        const { visualization, rlsUsername } = req.body;
        
        if (!visualization) {
            return res.status(400).json({ 
                error: 'Visualization definition is required' 
            });
        }

        // Check if Power BI credentials are configured for semantic model
        const isPBIConfigured = process.env.POWERBI_CLIENT_ID &&
                               process.env.POWERBI_CLIENT_SECRET &&
                               process.env.POWERBI_TENANT_ID &&
                               process.env.POWERBI_WORKSPACE_ID &&
                               process.env.POWERBI_DATASET_ID;

        if (!isPBIConfigured) {
            return res.status(500).json({
                error: 'Power BI semantic model credentials are not configured',
                details: 'Please set POWERBI_CLIENT_ID, POWERBI_CLIENT_SECRET, POWERBI_TENANT_ID, POWERBI_WORKSPACE_ID, and POWERBI_DATASET_ID in your .env file'
            });
        }

        // Generate a DAX query for the visualization
        console.log("Generating DAX query for visualization:", visualization);
        
        // Get DAX query based on visualization type and data roles
        const daxQuery = generateDaxQueryForVisualization(visualization);
        console.log("Generated DAX query:", daxQuery);
        
        // If we couldn't generate a valid DAX query
        if (!daxQuery) {
            return res.status(400).json({
                error: 'Could not generate a valid DAX query for this visualization',
                details: 'The visualization definition may be missing required fields or have an unsupported format'
            });
        }

        try {
            // Acquire AAD token for Power BI API
            const aadResponse = await axios({
                method: 'POST',
                url: `https://login.microsoftonline.com/${process.env.POWERBI_TENANT_ID}/oauth2/token`,
                data: new URLSearchParams({
                    grant_type: 'client_credentials',
                    client_id: process.env.POWERBI_CLIENT_ID,
                    client_secret: process.env.POWERBI_CLIENT_SECRET,
                    resource: 'https://analysis.windows.net/powerbi/api'
                }).toString(),
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });
            
            const aadToken = aadResponse.data.access_token;

            // Prepare query execution request
            const queryRequest = {
                queries: [
                    {
                        query: daxQuery
                    }
                ],
                serializerSettings: {
                    includeNulls: true
                }
            };
            
            // Add effective identity for RLS if username is provided
            if (rlsUsername) {
                queryRequest.impersonatedUserName = rlsUsername;
                queryRequest.effectiveUserName = rlsUsername;
            }
            
            // Execute query with RLS if applicable
            const queryResponse = await axios({
                method: 'POST',
                url: `https://api.powerbi.com/v1.0/myorg/groups/${process.env.POWERBI_WORKSPACE_ID}/datasets/${process.env.POWERBI_DATASET_ID}/executeQueries`,
                headers: {
                    'Authorization': `Bearer ${aadToken}`,
                    'Content-Type': 'application/json'
                },
                data: queryRequest,
                timeout: 15000
            });

            // Process query results
            console.log('Processing query results...');
            const queryResults = queryResponse.data.results[0];
            
            // Return successful response with results
            return res.json({
                visualization: visualization,
                daxQuery: daxQuery,
                queryResults: queryResults,
                success: true
            });
            
        } catch (queryError) {
            // Handle query execution errors
            console.error('Error executing query:', queryError.message);
            if (queryError.response?.data) {
                console.error('Query error details:', JSON.stringify(queryError.response.data, null, 2));
            }
            
            // Extract detailed error information if available
            let errorDetails = "";
            try {
                if (queryError.response?.data?.error?.['pbi.error']?.details &&
                    queryError.response?.data?.error?.['pbi.error']?.details.length > 0) {
                    errorDetails = queryError.response.data.error['pbi.error'].details[0].detail;
                    console.log('PBI Error details:', errorDetails);
                }
            } catch (e) {
                console.log('Error extracting PBI error details:', e);
            }
            
            return res.status(500).json({
                error: 'Error executing DAX query',
                details: errorDetails || queryError.message,
                daxQuery: daxQuery
            });
        }
    } catch (error) {
        console.error('Server Error:', error.message);
        return res.status(500).json({
            error: 'Internal server error',
            details: error.message
        });
    }
});

// Helper function to generate DAX queries for visualizations
function generateDaxQueryForVisualization(visualization) {
    try {
        if (!visualization || !visualization.type || !visualization.dataRoles || visualization.dataRoles.length === 0) {
            console.error('Invalid visualization definition:', visualization);
            return null;
        }
        
        // Extract visualization details
        const { type, dataRoles } = visualization;
        
        // Find category and value data roles
        const categoryRole = dataRoles.find(role => role.name === 'category');
        const valueRole = dataRoles.find(role => role.name === 'value' || role.name === 'values');
        
        // For most visualizations, we need at least a category and value
        if (!categoryRole || !valueRole) {
            console.error('Missing required data roles (category or value):', dataRoles);
            return null;
        }
        
        // Extract table and column names
        const categoryTable = categoryRole.table;
        const categoryColumn = categoryRole.column;
        const valueTable = valueRole.table;
        const valueColumn = valueRole.column;
        const aggregation = valueRole.aggregation || 'SUM';
        
        // Build the appropriate DAX query based on visualization type
        let daxQuery = '';
        
        switch (type.toLowerCase()) {
            case 'column':
            case 'bar':
            case 'line':
                // For column/bar/line charts, we want categories and their values
                daxQuery = `EVALUATE
                    SUMMARIZECOLUMNS(
                        ${categoryTable}[${categoryColumn}],
                        "Value", ${aggregation.toUpperCase()}(${valueTable}[${valueColumn}])
                    )
                    ORDER BY ${categoryTable}[${categoryColumn}] ASC`;
                break;
                
            case 'pie':
            case 'donut':
                // For pie/donut charts, similar to column but we want a percentage calculation too
                daxQuery = `EVALUATE
                    ADDCOLUMNS(
                        SUMMARIZECOLUMNS(
                            ${categoryTable}[${categoryColumn}],
                            "Value", ${aggregation.toUpperCase()}(${valueTable}[${valueColumn}])
                        ),
                        "Percentage", 
                        DIVIDE(
                            [Value],
                            CALCULATE(
                                ${aggregation.toUpperCase()}(${valueTable}[${valueColumn}]),
                                ALL(${categoryTable})
                            )
                        ) * 100
                    )
                    ORDER BY [Value] DESC`;
                break;
                
            case 'scatter':
                // For scatter plots, we need two value columns
                const secondValueRole = dataRoles.find(role => role.name === 'secondValue' || role.name === 'y');
                if (!secondValueRole) {
                    console.error('Missing required second value for scatter plot');
                    return null;
                }
                
                const secondValueTable = secondValueRole.table;
                const secondValueColumn = secondValueRole.column;
                const secondAggregation = secondValueRole.aggregation || 'SUM';
                
                daxQuery = `EVALUATE
                    SUMMARIZECOLUMNS(
                        ${categoryTable}[${categoryColumn}],
                        "X", ${aggregation.toUpperCase()}(${valueTable}[${valueColumn}]),
                        "Y", ${secondAggregation.toUpperCase()}(${secondValueTable}[${secondValueColumn}])
                    )`;
                break;
                
            case 'table':
                // For table visuals, just return the columns directly
                daxQuery = `EVALUATE
                    SUMMARIZECOLUMNS(
                        ${categoryTable}[${categoryColumn}],
                        "Value", ${aggregation.toUpperCase()}(${valueTable}[${valueColumn}])
                    )
                    ORDER BY ${categoryTable}[${categoryColumn}] ASC`;
                break;
                
            default:
                // Default to a simple summary for other visualization types
                daxQuery = `EVALUATE
                    SUMMARIZECOLUMNS(
                        ${categoryTable}[${categoryColumn}],
                        "Value", ${aggregation.toUpperCase()}(${valueTable}[${valueColumn}])
                    )
                    ORDER BY [Value] DESC`;
        }
        
        return daxQuery;
    } catch (error) {
        console.error('Error generating DAX query for visualization:', error);
        return null;
    }
}

// Modify the Power BI Embedding token API to include RLS
app.get('/api/pbi-token', async (req, res) => {
    try {
        // Get session ID from query parameter
        const { sessionId } = req.query;
        
        // Check if Power BI credentials are configured
        const isPBIConfigured = process.env.POWERBI_CLIENT_ID &&
                               process.env.POWERBI_CLIENT_SECRET &&
                               process.env.POWERBI_TENANT_ID &&
                               process.env.POWERBI_WORKSPACE_ID &&
                               process.env.POWERBI_REPORT_ID;
       
        if (!isPBIConfigured) {
            console.log('Power BI credentials not fully configured, returning development mode response');
            return res.json({
                status: 'development',
                message: "Power BI credentials not fully configured. Add your credentials to the .env file to enable embedding.",
                mockEmbedUrl: `https://app.powerbi.com/reportEmbed?reportId=sample&groupId=sample`,
                mockToken: "development_token"
            });
        }
       
        // Try to generate a real token if credentials are configured
        try {
            // First acquire AAD token
            const aadResponse = await axios({
                method: 'POST',
                url: `https://login.microsoftonline.com/${process.env.POWERBI_TENANT_ID}/oauth2/token`,
                data: new URLSearchParams({
                    grant_type: 'client_credentials',
                    client_id: process.env.POWERBI_CLIENT_ID,
                    client_secret: process.env.POWERBI_CLIENT_SECRET,
                    resource: 'https://analysis.windows.net/powerbi/api'
                }).toString(),
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });
           
            const aadToken = aadResponse.data.access_token;
           
            // Then get report info
            const reportResponse = await axios({
                method: 'GET',
                url: `https://api.powerbi.com/v1.0/myorg/groups/${process.env.POWERBI_WORKSPACE_ID}/reports/${process.env.POWERBI_REPORT_ID}`,
                headers: {
                    'Authorization': `Bearer ${aadToken}`
                }
            });
            
            // Create token request data
            const tokenRequestData = {
                datasets: [
                    { id: reportResponse.data.datasetId }
                ],
                reports: [
                    { id: process.env.POWERBI_REPORT_ID }
                ],
                targetWorkspaces: [
                    { id: process.env.POWERBI_WORKSPACE_ID }
                ],
                allowEdit: true // This allows editing, including filter pane
            };
            
            // Add RLS effective identity if session exists
            if (sessionId && userSessions[sessionId]) {
                const session = userSessions[sessionId];
                
                // Add effective identity for RLS
                tokenRequestData.identities = [
                    {
                        username: session.username,
                        roles: session.roles,
                        datasets: [reportResponse.data.datasetId]
                    }
                ];
                
                // Add custom data if provided (can be used in RLS rules)
                if (session.customData && Object.keys(session.customData).length > 0) {
                    tokenRequestData.identities[0].customData = session.customData;
                }
            }
           
            // Generate embed token with RLS if applicable
            const embedTokenResponse = await axios({
                method: 'POST',
                url: 'https://api.powerbi.com/v1.0/myorg/GenerateToken',
                data: tokenRequestData,
                headers: {
                    'Authorization': `Bearer ${aadToken}`,
                    'Content-Type': 'application/json'
                }
            });
           
            return res.json({
                status: 'production',
                embedUrl: reportResponse.data.embedUrl,
                reportId: process.env.POWERBI_REPORT_ID,
                token: embedTokenResponse.data.token,
                tokenExpiry: embedTokenResponse.data.expiration,
                hasRls: !!sessionId && !!userSessions[sessionId],
                username: sessionId && userSessions[sessionId] ? userSessions[sessionId].username : null
            });
            
        } catch (pbiError) {
            console.error('Power BI API Error:', pbiError.response?.data || pbiError.message);
           
            // Return an error response with details
            return res.json({
                status: 'error',
                message: "Error generating Power BI token. Check server logs for details.",
                error: pbiError.response?.data || pbiError.message
            });
        }
    } catch (error) {
        console.error('Power BI token acquisition error:', error.response?.data || error.message);
        return res.status(500).json({
            error: 'Failed to acquire Power BI token',
            details: error.response?.data || error.message
        });
    }
});

// Endpoint to check Power BI Semantic Model status
app.get('/api/semantic-model-status', async (req, res) => {
    try {
        // Check if Power BI Semantic Model credentials are set
        const isPBIConfigured = process.env.POWERBI_CLIENT_ID &&
                               process.env.POWERBI_CLIENT_SECRET &&
                               process.env.POWERBI_TENANT_ID &&
                               process.env.POWERBI_WORKSPACE_ID &&
                               process.env.POWERBI_DATASET_ID;
       
        if (!isPBIConfigured) {
            return res.json({
                configured: false,
                message: "Power BI Semantic Model is not configured."
            });
        }
       
        // Validate that we can connect to the semantic model
        try {
            // First acquire AAD token
            const aadResponse = await axios({
                method: 'POST',
                url: `https://login.microsoftonline.com/${process.env.POWERBI_TENANT_ID}/oauth2/token`,
                data: new URLSearchParams({
                    grant_type: 'client_credentials',
                    client_id: process.env.POWERBI_CLIENT_ID,
                    client_secret: process.env.POWERBI_CLIENT_SECRET,
                    resource: 'https://analysis.windows.net/powerbi/api'
                }).toString(),
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });
           
            const aadToken = aadResponse.data.access_token;
           
            // Get dataset info
            const datasetResponse = await axios({
                method: 'GET',
                url: `https://api.powerbi.com/v1.0/myorg/groups/${process.env.POWERBI_WORKSPACE_ID}/datasets/${process.env.POWERBI_DATASET_ID}`,
                headers: {
                    'Authorization': `Bearer ${aadToken}`
                }
            });
           
            return res.json({
                configured: true,
                active: true,
                message: "Power BI Semantic Model is configured and available.",
                datasetName: datasetResponse.data.name,
                datasetId: datasetResponse.data.id
            });
        } catch (pbiError) {
            console.error('Power BI Semantic Model validation error:', pbiError.response?.data || pbiError.message);
           
            return res.json({
                configured: true,
                active: false,
                message: "Power BI Semantic Model is configured but there was an error connecting to it.",
                error: pbiError.response?.data?.error?.message || pbiError.message
            });
        }
    } catch (error) {
        console.error('Server Error:', error.message);
        return res.status(500).json({
            error: 'Internal server error',
            details: error.message
        });
    }
});

// Add DAX validator helper function
function validateDaxQuery(query) {
  if (!query || typeof query !== 'string') {
    return { valid: false, error: 'Query is empty or not a string' };
  }
  
  // Trim whitespace and remove extra spaces
  const cleanedQuery = query.trim();
  
  // Check for basic DAX syntax
  const evaluateIndex = cleanedQuery.toUpperCase().indexOf('EVALUATE');
  
  if (evaluateIndex === -1) {
    console.log('DAX query is missing EVALUATE keyword:', cleanedQuery);
    // Try to fix it by adding EVALUATE
    return { 
      valid: false, 
      error: 'DAX query must begin with EVALUATE',
      fixedQuery: `EVALUATE ${cleanedQuery}`
    };
  } else if (evaluateIndex > 0) {
    // EVALUATE isn't at the beginning
    const prefix = cleanedQuery.substring(0, evaluateIndex).trim();
    if (prefix) {
      console.log('DAX query has content before EVALUATE:', cleanedQuery);
      return {
        valid: false,
        error: 'EVALUATE should be at the beginning of the query',
        fixedQuery: cleanedQuery.substring(evaluateIndex)
      };
    }
  }
  
  // Check for unbalanced parentheses
  let openParens = 0;
  for (const char of cleanedQuery) {
    if (char === '(') openParens++;
    if (char === ')') openParens--;
    if (openParens < 0) {
      return { valid: false, error: 'Unbalanced parentheses: too many closing parentheses' };
    }
  }
  
  if (openParens > 0) {
    return { valid: false, error: 'Unbalanced parentheses: missing closing parentheses' };
  }
  
  // Check for unbalanced quotes
  let inSingleQuotes = false;
  let inDoubleQuotes = false;
  
  for (const char of cleanedQuery) {
    if (char === "'" && !inDoubleQuotes) inSingleQuotes = !inSingleQuotes;
    if (char === '"' && !inSingleQuotes) inDoubleQuotes = !inDoubleQuotes;
  }
  
  if (inSingleQuotes) {
    return { valid: false, error: 'Unbalanced quotes: missing closing single quote' };
  }
  
  if (inDoubleQuotes) {
    return { valid: false, error: 'Unbalanced quotes: missing closing double quote' };
  }
  
  // If query is just EVALUATE alone or with spaces, it's invalid
  if (cleanedQuery.toUpperCase().trim() === 'EVALUATE') {
    return { valid: false, error: 'Query contains only EVALUATE keyword with no expression' };
  }
  
  return { valid: true, query: cleanedQuery };
}

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});