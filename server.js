require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;


// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));


// Azure OpenAI API endpoint - Modified to query Power BI semantic model
app.post('/api/chat', async (req, res) => {
    try {
        const { message } = req.body;
       
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


        // Step 1: First, use Azure OpenAI to convert natural language to DAX query
        try {
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
                            Convert natural language to DAX queries. Output only the DAX query without explanation. Do not quote the query with any backticks. Here is the metadata: tableName: sales | column names: CustomerName, EmailAddress, TaxAmount, Quantity, OrderDate, SalesOrderLineNumber, SalesOrderNumber,UnitPrice, Item. Based on the input pick the best matching column.
                            For example, if the user asks "What were the total sales last year?", 
                            you might output: "EVALUATE ROW(\"Total Sales\", CALCULATE(SUM(Sales[Amount]), PREVIOUSYEAR(Calendar[Date])))".
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


            // Step 3: Execute DAX query against the Power BI dataset
            try {
                console.log('Executing DAX query:', finalDaxQuery);
                
                const queryResponse = await axios({
                    method: 'POST',
                    url: `https://api.powerbi.com/v1.0/myorg/groups/${process.env.POWERBI_WORKSPACE_ID}/datasets/${process.env.POWERBI_DATASET_ID}/executeQueries`,
                    headers: {
                        'Authorization': `Bearer ${aadToken}`,
                        'Content-Type': 'application/json'
                    },
                    data: {
                        queries: [
                            {
                                query: finalDaxQuery
                            }
                        ],
                        serializerSettings: {
                            includeNulls: true
                        }
                    },
                    timeout: 15000
                });


                // Process query results and generate explanation
                console.log('Processing query results...');
                const queryResults = queryResponse.data.results[0];
                console.log('Query results:', JSON.stringify(queryResults, null, 2));
                
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
                                Based on the query results, provide a clear, concise explanation.
                                Also mention that this data comes from the Power BI semantic model.`
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
                    isPowerBIData: true
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
                    This might be because I don't have the right table or column names for your specific dataset.
                    Could you try asking in a different way or provide some information about what tables are available in your dataset?`,
                    isPowerBIData: false
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


// Endpoint to process Power BI filter requests
app.post('/api/pbi-filter', async (req, res) => {
    try {
        const { message } = req.body;
       
        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }


        // Check if Azure OpenAI credentials are set
        if (!process.env.AZURE_OPENAI_API_KEY || 
            !process.env.AZURE_OPENAI_ENDPOINT || 
            !process.env.AZURE_OPENAI_DEPLOYMENT_NAME) {
            return res.status(500).json({
                filters: [],
                explanation: "Azure OpenAI credentials are not configured. Please add your keys to the .env file."
            });
        }


        // Use Azure OpenAI to convert natural language to filter
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
                            content: `You are a Power BI filter generator. Convert natural language to Power BI filter JSON. Here is the metadata: tableName: sales | column names: CustomerName, EmailAddress, TaxAmount. Based on the input pick the best matching column name.


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
                              "explanation": "Human-readable explanation of the filter"
                            }
                           
                            For example, "Show sales for last quarter" might output:
                            {
                              "filters": [
                                {
                                  "table": "Date",
                                  "column": "Quarter",
                                  "operator": "Equals",
                                  "values": ["Q4"]
                                }
                              ],
                              "explanation": "Showing sales for the last quarter (Q4)."
                            }
                           
                            Only respond with valid JSON. If you can't generate a filter, return {"filters": [], "explanation": "I couldn't create a filter from that query."}`
                        },
                        { role: "user", content: message }
                    ],
                    max_tokens: 800,
                    temperature: 0.3
                }
            });


            // Extract and parse the content from response
            const content = response.data.choices[0].message.content;
           
            // Try to parse the response as JSON
            try {
                const filterData = JSON.parse(content);
                return res.json(filterData);
            } catch (parseError) {
                console.error('Error parsing OpenAI response as JSON:', parseError);
                console.log('Raw response:', content);
                return res.json({
                    filters: [],
                    explanation: "I received a response but couldn't parse it into a valid filter. This usually happens when the AI response isn't properly formatted JSON."
                });
            }
        } catch (apiError) {
            console.error('Azure OpenAI API Error:', apiError.response?.data || apiError.message);
           
            // Handle specific API errors
            if (apiError.response?.status === 401) {
                return res.json({
                    filters: [],
                    explanation: "Authentication error with Azure OpenAI. Your API key may be invalid or expired."
                });
            } else if (apiError.response?.status === 404) {
                return res.json({
                    filters: [],
                    explanation: "Azure OpenAI resource not found. Check your deployment name and endpoint URL."
                });
            } else {
                return res.json({
                    filters: [],
                    explanation: "Error connecting to Azure OpenAI: " + (apiError.response?.data?.error?.message || apiError.message)
                });
            }
        }
    } catch (error) {
        console.error('Server Error:', error.message);
        return res.json({
            filters: [],
            explanation: "A server error occurred while processing your request: " + error.message
        });
    }
});


// Power BI Embedding token API
app.get('/api/pbi-token', async (req, res) => {
    try {
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
           
            // Generate embed token with explicit permissions for filter pane
            const embedTokenResponse = await axios({
                method: 'POST',
                url: 'https://api.powerbi.com/v1.0/myorg/GenerateToken',
                data: {
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
                },
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
                tokenExpiry: embedTokenResponse.data.expiration
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


// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});



