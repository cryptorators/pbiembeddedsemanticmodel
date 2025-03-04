document.addEventListener('DOMContentLoaded', function() {
    // DOM elements
    const elements = {
        pbiMessages: document.getElementById('pbi-messages'),
        pbiInput: document.getElementById('pbi-input'),
        pbiSendBtn: document.getElementById('pbi-send'),
        openaiMessages: document.getElementById('openai-messages'),
        openaiInput: document.getElementById('openai-input'),
        openaiSendBtn: document.getElementById('openai-send'),
        reportStatus: document.querySelector('.report-status'),
        reportContainer: document.getElementById('powerbi-report')
    };


    // State
    let reportObj = null;
    let reportLoaded = false;
    let pbiWaitingForResponse = false;
    let openaiWaitingForResponse = false;
   
    // Helper function to show a placeholder for the report
    function showReportPlaceholder(message = null) {
        // Clear existing content
        while (elements.reportContainer.firstChild) {
            elements.reportContainer.removeChild(elements.reportContainer.firstChild);
        }
       
        // Create placeholder
        const placeholderDiv = document.createElement('div');
        placeholderDiv.className = 'report-placeholder';
        placeholderDiv.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #555;">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 3v18h18" />
                    <path d="M18 17l-5-6-3 3-3-3" />
                </svg>
                <p style="margin-top: 15px; font-size: 1.1rem;">Power BI Report Placeholder</p>
                ${message ? `<p style="margin-top: 5px; font-size: 0.9rem; color: #d32f2f;">${message}</p>` : ''}
                <p style="margin-top: 5px; font-size: 0.9rem;">Add your Power BI credentials in the .env file to see your actual report</p>
            </div>
        `;
        elements.reportContainer.appendChild(placeholderDiv);
    }


    // Add a specific function to toggle the filter pane
    // This can be called from the browser console for debugging
    function toggleFilterPane() {
        if (reportObj) {
            // Basic approach to toggle filter pane
            reportObj.getSettings()
                .then(settings => {
                    console.log('Current report settings:', settings);
                    // Toggle the filterPaneEnabled setting
                    const isFilterPaneVisible = settings.filterPaneEnabled;
                   
                    return reportObj.updateSettings({
                        filterPaneEnabled: !isFilterPaneVisible
                    });
                })
                .then(() => {
                    console.log('Filter pane visibility toggled');
                })
                .catch(error => {
                    console.error('Error toggling filter pane:', error);
                });
        } else {
            console.error('Report object not available');
            alert('Report is not yet loaded. Please wait and try again.');
        }
    }
   
    // Expose this function globally for debugging
    window.toggleFilterPane = toggleFilterPane;


    async function initPowerBIReport() {
        elements.reportStatus.textContent = 'Connecting...';
       
        try {
            // Fetch embed token from backend
            const response = await fetch('/api/pbi-token');
            const tokenData = await response.json();
           
            if (response.status !== 200) {
                throw new Error(tokenData.error || 'Error fetching Power BI token');
            }
            // In a production app, you would use the actual token data
            // For now, we'll continue with development mode values
            console.log("Token response:", tokenData);
            elements.reportStatus.textContent = 'Development mode: Report would be loaded with a real token';
           
            // For development, you might want to use a different embed URL or sample report
            // Define embed configuration with filter pane explicitly enabled
            const embedConfig = {
                type: 'report',
                tokenType: 1, // Embed token
                accessToken: tokenData.mockToken || 'development_token',
                embedUrl: tokenData.mockEmbedUrl || 'https://app.powerbi.com/reportEmbed',
                id: 'development_report_id',
                permissions: 1, // View
                settings: {
                    navContentPaneEnabled: true,
                    filterPaneEnabled: true
                }
            };
            // Get models instance and embed report
            const powerbi = window.powerbi;
           
            // Try to embed the report if we have proper credentials
            try {
                // Check if we have the required token data
                if (tokenData.token && tokenData.embedUrl && tokenData.reportId) {
                    // We have real credentials, use them
                    const realEmbedConfig = {
                        type: 'report',
                        tokenType: 1, // Embed token
                        accessToken: tokenData.token,
                        embedUrl: tokenData.embedUrl,
                        id: tokenData.reportId,
                        permissions: 1, // View
                        settings: {
                            navContentPaneEnabled: false,
                            filterPaneEnabled: false
                        }
                    };
                   
                    reportObj = powerbi.embed(elements.reportContainer, realEmbedConfig);
                   
                    // Report event handlers
                    reportObj.on('loaded', function() {
                        elements.reportStatus.textContent = 'Report loaded';
                        reportLoaded = true;
                       
                        // Explicitly show filter pane after loading with a simpler approach
                        try {
                            reportObj.updateSettings({
                                filterPaneEnabled: true
                            });
                            console.log('Filter pane visibility explicitly set after load');
                        } catch (settingsError) {
                            console.error('Error updating filter pane settings:', settingsError);
                        }
                    });
                   
                    reportObj.on('error', function(event) {
                        elements.reportStatus.textContent = 'Error: ' + event.detail.message;
                        console.error('Power BI Error:', event.detail);
                        showReportPlaceholder("Error loading report: " + event.detail.message);
                    });
                } else {
                    // We don't have real credentials, show placeholder
                    showReportPlaceholder("Waiting for Power BI credentials");
                }
            } catch (embedError) {
                console.error('Error embedding report:', embedError);
                showReportPlaceholder("Error embedding report: " + embedError.message);
            }
           
            // If we don't have a proper token response, show placeholder
            if (!tokenData.token || !tokenData.embedUrl) {
                elements.reportStatus.textContent = 'Development: Report simulated';
                reportLoaded = true; // Set to true so filters can still be processed
                showReportPlaceholder();
            }
           
        } catch (error) {
            console.error('Power BI initialization error:', error);
            elements.reportStatus.textContent = 'Error: ' + (error.message || 'Could not load report');
        }
    }


    // Helper to add messages to chat
    function addMessage(chatContainer, text, type) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', type);
        messageElement.textContent = text;
        chatContainer.appendChild(messageElement);
        chatContainer.scrollTop = chatContainer.scrollHeight;
        return messageElement;
    }


    // Helper to add a table to display query results
    function addResultTable(chatContainer, queryResults) {
        if (!queryResults) {
            console.log('No query results to display');
            return null;
        }
        
        console.log('Query results structure:', JSON.stringify(queryResults, null, 2));
        
        // Create a formatted table element for the results
        const tableElement = document.createElement('div');
        tableElement.classList.add('message', 'assistant', 'query-results');
        
        // Handle different structures of query results
        try {
            // Create an HTML table
            let tableHtml = '<table class="results-table">';
            
            // First, determine the structure of the data to extract column names and rows
            if (queryResults.tables && queryResults.tables.length > 0) {
                // Standard structure with tables array
                const table = queryResults.tables[0];
                
                // Add headers
                tableHtml += '<thead><tr>';
                // Check if columns is an array
                if (Array.isArray(table.columns)) {
                    for (const column of table.columns) {
                        tableHtml += `<th>${column.name || column}</th>`;
                    }
                } else if (table.columns && typeof table.columns === 'object') {
                    // Handle if columns is an object with properties
                    const columnNames = Object.keys(table.columns);
                    for (const name of columnNames) {
                        tableHtml += `<th>${name}</th>`;
                    }
                }
                tableHtml += '</tr></thead>';
                
                // Add data rows
                tableHtml += '<tbody>';
                if (Array.isArray(table.rows)) {
                    for (const row of table.rows) {
                        tableHtml += '<tr>';
                        if (Array.isArray(row)) {
                            for (const value of row) {
                                const formattedValue = formatTableValue(value);
                                tableHtml += `<td>${formattedValue}</td>`;
                            }
                        } else if (typeof row === 'object') {
                            // Handle if row is an object with properties
                            const values = Object.values(row);
                            for (const value of values) {
                                const formattedValue = formatTableValue(value);
                                tableHtml += `<td>${formattedValue}</td>`;
                            }
                        }
                        tableHtml += '</tr>';
                    }
                }
            } else if (queryResults.results && queryResults.results.length > 0) {
                // Alternative structure with results array (Power BI REST API style)
                const result = queryResults.results[0];
                
                // Try to get the column names
                let columnNames = [];
                
                // Try to determine columns from metadata if available
                if (result.metadata && Array.isArray(result.metadata)) {
                    columnNames = result.metadata.map(col => col.displayName || col.name);
                } else if (result.tables && result.tables.length > 0) {
                    // Try to get column names from the first table
                    const firstTable = result.tables[0];
                    if (firstTable.columns && Array.isArray(firstTable.columns)) {
                        columnNames = firstTable.columns.map(col => col.name);
                    }
                }
                
                // If still no column names but we have data, extract from the first row
                if (columnNames.length === 0 && result.data && Array.isArray(result.data)) {
                    if (result.data.length > 0 && typeof result.data[0] === 'object') {
                        columnNames = Object.keys(result.data[0]);
                    }
                }
                
                // Add headers
                tableHtml += '<thead><tr>';
                for (const column of columnNames) {
                    tableHtml += `<th>${column}</th>`;
                }
                tableHtml += '</tr></thead>';
                
                // Add data rows
                tableHtml += '<tbody>';
                if (result.data && Array.isArray(result.data)) {
                    for (const row of result.data) {
                        tableHtml += '<tr>';
                        if (Array.isArray(row)) {
                            for (const value of row) {
                                const formattedValue = formatTableValue(value);
                                tableHtml += `<td>${formattedValue}</td>`;
                            }
                        } else if (typeof row === 'object') {
                            for (const column of columnNames) {
                                const value = row[column];
                                const formattedValue = formatTableValue(value);
                                tableHtml += `<td>${formattedValue}</td>`;
                            }
                        }
                        tableHtml += '</tr>';
                    }
                }
            } else if (typeof queryResults === 'object') {
                // Fallback: Try to render the query results as a simple key-value table
                tableHtml += '<thead><tr><th>Property</th><th>Value</th></tr></thead>';
                tableHtml += '<tbody>';
                
                const renderObject = (obj, prefix = '') => {
                    for (const [key, value] of Object.entries(obj)) {
                        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
                            // Skip nested objects to avoid too much complexity
                            tableHtml += `<tr><td>${prefix}${key}</td><td><em>[Object]</em></td></tr>`;
                        } else if (Array.isArray(value)) {
                            tableHtml += `<tr><td>${prefix}${key}</td><td><em>[Array: ${value.length} items]</em></td></tr>`;
                        } else {
                            const formattedValue = formatTableValue(value);
                            tableHtml += `<tr><td>${prefix}${key}</td><td>${formattedValue}</td></tr>`;
                        }
                    }
                };
                
                renderObject(queryResults);
            }
            
            tableHtml += '</tbody></table>';
            
            // Set the table HTML
            tableElement.innerHTML = tableHtml;
            
            // Add to the chat
            chatContainer.appendChild(tableElement);
            chatContainer.scrollTop = chatContainer.scrollHeight;
            return tableElement;
        } catch (error) {
            console.error('Error rendering query results:', error);
            tableElement.textContent = 'Could not display results: ' + error.message;
            chatContainer.appendChild(tableElement);
            return tableElement;
        }
    }
    
    // Helper function to format table values
    function formatTableValue(value) {
        if (value === null || value === undefined) {
            return '<em>N/A</em>';
        } else if (typeof value === 'number') {
            return value.toLocaleString();
        } else if (typeof value === 'boolean') {
            return value ? 'Yes' : 'No';
        } else if (value instanceof Date) {
            return value.toLocaleDateString();
        } else if (typeof value === 'object') {
            return '<em>[Object]</em>';
        } else if (Array.isArray(value)) {
            return '<em>[Array]</em>';
        } else {
            return String(value);
        }
    }


    // Add loading indicator to chat
    function addLoadingIndicator(chatContainer) {
        const loadingElement = document.createElement('div');
        loadingElement.classList.add('loading-indicator');
       
        for (let i = 0; i < 3; i++) {
            const dot = document.createElement('div');
            dot.classList.add('dot');
            loadingElement.appendChild(dot);
        }
       
        chatContainer.appendChild(loadingElement);
        chatContainer.scrollTop = chatContainer.scrollHeight;
        return loadingElement;
    }


    // Process Power BI filter chat message
    async function processPBIFilterMessage(message) {
        if (pbiWaitingForResponse) return;
       
        pbiWaitingForResponse = true;
        const loadingIndicator = addLoadingIndicator(elements.pbiMessages);
        try {
            // Check if report is loaded
            if (!reportLoaded) {
                return "The Power BI report is not yet loaded. Please wait a moment.";
            }
           
            // Call the backend API to process the filter
            const response = await fetch('/api/pbi-filter', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ message })
            });
            // Handle various HTTP errors
            if (!response.ok) {
                if (response.status === 404) {
                    throw new Error(`API endpoint not found (404). Make sure the server is running and the endpoint is configured.`);
                } else if (response.status === 500) {
                    const errorData = await response.json();
                    throw new Error(`Server error: ${errorData.details || 'Unknown server error'}`);
                } else {
                    throw new Error(`Error: ${response.status} - ${response.statusText}`);
                }
            }
            const data = await response.json();
           
            // Apply filters to the report if available
            if (reportLoaded && data.filters && data.filters.length > 0) {
                try {
                    // Convert to Power BI format
                    const pbiFilters = data.filters.map(filter => {
                        return {
                            $schema: "http://powerbi.com/product/schema#basic",
                            target: {
                                table: filter.table,
                                column: filter.column
                            },
                            operator: filter.operator,
                            values: filter.values
                        };
                    });
                   
                    if (reportObj) {
                        // If we have a real report object, apply the filters
                        await reportObj.setFilters(pbiFilters);
                        console.log('Applied filters:', pbiFilters);
                    } else {
                        // In development mode, just log
                        console.log('Development mode - would apply filters:', pbiFilters);
                    }
                } catch (filterError) {
                    console.error('Error applying filter:', filterError);
                    return `${data.explanation} (Note: The filter was generated but couldn't be applied to the report)`;
                }
            } else if (data.filters && data.filters.length === 0 && message.toLowerCase().includes('clear')) {
                // Clear all filters if requested
                if (reportObj) {
                    await reportObj.removeFilters();
                    console.log('Cleared all filters');
                } else {
                    console.log('Development mode - would clear all filters');
                }
            }
           
            // Return explanation to display
            return data.explanation || "I processed your request.";
        } catch (error) {
            console.error('Error processing PBI filter:', error);
            return `Error: ${error.message || 'An unknown error occurred while processing your filter request.'}`;
        } finally {
            // Remove loading indicator
            if (loadingIndicator && loadingIndicator.parentNode) {
                loadingIndicator.parentNode.removeChild(loadingIndicator);
            }
            pbiWaitingForResponse = false;
        }
    }


    // Process Azure OpenAI chat message - Modified to handle semantic model query results
    async function processOpenAIMessage(message) {
        if (openaiWaitingForResponse) return;
       
        openaiWaitingForResponse = true;
        const loadingIndicator = addLoadingIndicator(elements.openaiMessages);
        
        // Set a timeout to abort the request if it takes too long
        const timeoutId = setTimeout(() => {
            if (openaiWaitingForResponse) {
                // Clean up loading indicator
                if (loadingIndicator && loadingIndicator.parentNode) {
                    loadingIndicator.parentNode.removeChild(loadingIndicator);
                }
                
                // Add error message
                addMessage(elements.openaiMessages, 
                    "I'm sorry, but the request is taking too long to complete. Please try a simpler question or try again later.", 
                    'error');
                
                openaiWaitingForResponse = false;
            }
        }, 30000); // 30 second timeout
        
        try {
            // Call the backend API
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ message })
            });
            
            // Clear the timeout since we got a response
            clearTimeout(timeoutId);
            
            // Handle various HTTP errors
            if (!response.ok) {
                if (response.status === 404) {
                    throw new Error(`API endpoint not found (404). Make sure the server is running and the endpoint is configured.`);
                } else if (response.status === 500) {
                    const errorData = await response.json();
                    throw new Error(`Server error: ${errorData.details || 'Unknown server error'}`);
                } else {
                    throw new Error(`Error: ${response.status} - ${response.statusText}`);
                }
            }
            const data = await response.json();
           
            // Update chat header based on what was used to answer
            const chatHeaderTitle = document.querySelector('.chat-box:nth-child(2) .chat-header h3');
            const chatHeaderDesc = document.querySelector('.chat-box:nth-child(2) .chat-header p');
           
            // Update the header based on response type
            if (data.isPowerBIData) {
                // Using Power BI Semantic Model
                // Check if badge already exists
                if (!chatHeaderTitle.querySelector('.pbi-badge')) {
                    chatHeaderTitle.innerHTML = 'General Assistant <span class="pbi-badge">Power BI Data</span>';
                }
                chatHeaderDesc.textContent = 'Ask questions using Power BI semantic model';
                
                // If we have query results, create a table for them
                if (data.queryResults) {
                    // Create a table for the results if they exist
                    addResultTable(elements.openaiMessages, data.queryResults);
                    
                    // If this is a fallback query, add a note about it
                    if (data.isFallback) {
                        const noteElement = document.createElement('div');
                        noteElement.classList.add('message', 'assistant', 'fallback-note');
                        noteElement.innerHTML = `<em>Note: I couldn't execute your exact query, so I've shown some sample data from the dataset instead.</em>`;
                        elements.openaiMessages.appendChild(noteElement);
                    }
                }
            } else {
                // Standard OpenAI
                // Remove badge if exists
                chatHeaderTitle.innerHTML = 'General Assistant';
                chatHeaderDesc.textContent = 'Ask any questions';
            }
           
            return data.response || "I processed your message.";
        } catch (error) {
            // Clear the timeout since we got an error
            clearTimeout(timeoutId);
            
            console.error('Error processing chat message:', error);
            return `Error: ${error.message || 'Unknown error occurred. Please check your server configuration and Azure OpenAI credentials.'}`;
        } finally {
            // Remove loading indicator
            if (loadingIndicator && loadingIndicator.parentNode) {
                loadingIndicator.parentNode.removeChild(loadingIndicator);
            }
            openaiWaitingForResponse = false;
        }
    }


    // Event Listeners
   
    // Toggle Filter Pane Button
    const toggleFilterPaneBtn = document.getElementById('toggle-filter-pane');
    if (toggleFilterPaneBtn) {
        toggleFilterPaneBtn.addEventListener('click', function() {
            toggleFilterPane();
        });
    }
   
    // PBI Filter Chat
    elements.pbiSendBtn.addEventListener('click', async function() {
        const message = elements.pbiInput.value.trim();
        if (!message || pbiWaitingForResponse) return;
       
        // Add user message to chat
        addMessage(elements.pbiMessages, message, 'user');
        elements.pbiInput.value = '';
       
        // Process message and get response
        const response = await processPBIFilterMessage(message);
       
        // Add assistant response to chat
        if (response) {
            addMessage(elements.pbiMessages, response, 'assistant');
        }
    });


    elements.pbiInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && !pbiWaitingForResponse) {
            elements.pbiSendBtn.click();
        }
    });


    // Azure OpenAI Chat
    elements.openaiSendBtn.addEventListener('click', async function() {
        const message = elements.openaiInput.value.trim();
        if (!message || openaiWaitingForResponse) return;
       
        // Add user message to chat
        addMessage(elements.openaiMessages, message, 'user');
        elements.openaiInput.value = '';
       
        // Process message and get response
        const response = await processOpenAIMessage(message);
       
        // Add assistant response to chat
        if (response) {
            addMessage(elements.openaiMessages, response, 'assistant');
        }
    });


    elements.openaiInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && !openaiWaitingForResponse) {
            elements.openaiSendBtn.click();
        }
    });


    // Initialize the app
    function init() {
        // Initialize Power BI report
        initPowerBIReport();
        
        // Check if Power BI Semantic Model is configured
        checkSemanticModelStatus();
    }
   
    // Removed Azure AI Search check as it's no longer needed
    
    // Function to check if Power BI Semantic Model is configured
    async function checkSemanticModelStatus() {
        try {
            const response = await fetch('/api/semantic-model-status');
           
            if (response.ok) {
                const data = await response.json();
               
                if (data.configured && data.active) {
                    // Update UI to show semantic model is enabled
                    const chatHeaderTitle = document.querySelector('.chat-box:nth-child(2) .chat-header h3');
                    const chatHeaderDesc = document.querySelector('.chat-box:nth-child(2) .chat-header p');
                   
                    // Only update if not already set for search
                    if (!chatHeaderTitle.querySelector('.search-badge')) {
                        chatHeaderTitle.innerHTML = 'General Assistant <span class="pbi-badge">Power BI Data</span>';
                        chatHeaderDesc.textContent = 'Ask questions using Power BI semantic model';
                    }
                   
                    // Update welcome message
                    const welcomeMessage = document.querySelector('#openai-messages .message.system');
                    if (!welcomeMessage.textContent.includes('Power BI')) {
                        welcomeMessage.textContent = "Hello! I'm your assistant powered by Azure OpenAI with Power BI semantic model integration. I can answer questions using data from your Power BI datasets. Try asking me something like 'What were the total sales last month?' or any question about your data. How can I help you today?";
                    }
                   
                    console.log('Power BI Semantic Model info:', data.datasetName);
                } else if (data.configured) {
                    console.warn('Power BI Semantic Model is configured but not active:', data.message);
                }
            }
        } catch (error) {
            console.error("Error checking semantic model status:", error);
        }
    }


    // Start the app
    init();
});



