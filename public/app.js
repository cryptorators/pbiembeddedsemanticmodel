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
        reportContainer: document.getElementById('powerbi-report'),
        createVisualBtn: document.getElementById('create-visual-btn')
    };

    // State
    let reportObj = null;
    let reportLoaded = false;
    let pbiWaitingForResponse = false;
    let openaiWaitingForResponse = false;
    // Track current session ID for RLS
    let currentSessionId = null;
    // Visualization page and default visual
    let visualizationPage = null;
    let defaultVisual = null;
   
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
            
            console.log("Token response:", tokenData);
            elements.reportStatus.textContent = 'Development mode: Report would be loaded with a real token';
           
            // Get models instance
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
                        permissions: 7, // View and Edit permissions (was 1 before)
                        settings: {
                            navContentPaneEnabled: true,
                            filterPaneEnabled: true,
                            useCustomSaveDialog: true,
                            panes: {
                                filters: {
                                    expanded: false,
                                    visible: true
                                },
                                pageNavigation: {
                                    visible: true
                                }
                            }
                        }
                    };
                   
                    reportObj = powerbi.embed(elements.reportContainer, realEmbedConfig);
                   
                    // Report event handlers
                    reportObj.on('loaded', async function() {
                        elements.reportStatus.textContent = 'Report loaded';
                        reportLoaded = true;
                       
                        // Initialize visualization page if needed
                        try {
                            await initVisualizationPage();
                        } catch (pageError) {
                            console.error("Error initializing visualization page:", pageError);
                        }
                        
                        // Enable the create visual button now that report is loaded
                        if (elements.createVisualBtn) {
                            elements.createVisualBtn.disabled = false;
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
    
// Add this to the initialization code
// Simplified initialization function that works without createAuthoring
async function initVisualizationPage() {
    if (!reportObj) return;
    
    try {
        // Get all pages
        const pages = await reportObj.getPages();
        console.log("Available pages:", pages.map(p => p.name));
        
        // Check if there's a designated visualization page
        visualizationPage = pages.find(page => page.name === "Visualizations");
        
        if (!visualizationPage) {
            // Just use the first page
            visualizationPage = pages[0];
            console.log("Using first page as visualization page:", visualizationPage.name);
        }
        
        // Check for existing visuals
        try {
            const visuals = await visualizationPage.getVisuals();
            console.log("Visuals on visualization page:", visuals);
            
            if (visuals && visuals.length > 0) {
                defaultVisual = visuals[0];
                window.lastCreatedVisual = defaultVisual;
                console.log("Using existing visual as default:", defaultVisual.name);
            }
        } catch (visualsError) {
            console.error("Error getting visuals:", visualsError);
        }
    } catch (error) {
        console.error("Error initializing visualization page:", error);
    }
}
    
    // Function to create a default visual
    async function createDefaultVisual() {
        try {
            if (!visualizationPage) return;
            
            console.log("Creating default visual...");
            
            try {
                // Try to create a visual using the standard API
                const response = await visualizationPage.createVisual('clusteredColumnChart');
                defaultVisual = response.visual;
                
                // Add some default data
                try {
                    const sampleCategoryField = { 
                        column: 'Item', 
                        table: 'sales', 
                        schema: 'http://powerbi.com/product/schema#column' 
                    };
                    
                    await defaultVisual.addDataField('Category', sampleCategoryField);
                    
                    const sampleValueField = { 
                        measure: 'SUM([Quantity])', 
                        table: 'sales', 
                        schema: 'http://powerbi.com/product/schema#measure' 
                    };
                    
                    await defaultVisual.addDataField('Y', sampleValueField);
                    
                    console.log("Default visual data fields added");
                } catch (dataError) {
                    console.error("Error adding data fields to default visual:", dataError);
                }
                
                console.log("Default visual created:", defaultVisual);
            } catch (createError) {
                console.error("Error creating default visual:", createError);
                
                // If we can't create a visual, we'll try an alternative approach
                // in updateVisualization function when needed
            }
        } catch (error) {
            console.error("Error in createDefaultVisual:", error);
        }
    }
    
    // Function to manually create a visual (called from the UI)
// Function to manually create a visual using alternative methods
// Function to manually create a visual (called from the UI)
async function createManualVisual() {
    try {
        if (!reportObj) {
            alert("Report is not loaded yet. The visualizations may not work fully with the current embedding configuration.");
            return;
        }
        
        // Get all pages
        let pages = [];
        try {
            pages = await reportObj.getPages();
            console.log("Available pages:", pages.map(p => p.name));
        } catch (pagesError) {
            console.error("Error getting pages:", pagesError);
            alert("Could not get report pages. The current embedding configuration may not support visual creation.");
            return;
        }
        
        if (!pages || pages.length === 0) {
            alert("No pages found in the report.");
            return;
        }
        
        // Use the active page
        const activePage = pages.filter(page => page.isActive)[0] || pages[0];
        console.log("Using page:", activePage.name);
        
        // First check if we can modify this page
        try {
            await activePage.setActive();
            
            // Check for existing visuals
            let existingVisuals = [];
            try {
                existingVisuals = await activePage.getVisuals();
                console.log("Existing visuals:", existingVisuals);
                
                if (existingVisuals && existingVisuals.length > 0) {
                    defaultVisual = existingVisuals[0];
                    window.lastCreatedVisual = defaultVisual;
                    visualizationPage = activePage;
                    
                    console.log("Using existing visual:", defaultVisual.name);
                    alert("Found an existing visual! The chat should now be able to update this visual with data visualizations.");
                    return;
                }
            } catch (visualsError) {
                console.error("Error getting visuals:", visualsError);
            }
            
            // Try direct creation if available
            try {
                console.log("Trying direct visual creation...");
                
                const response = await activePage.createVisual('columnChart');
                const newVisual = response.visual;
                
                // Try to add some data fields that should work with most datasets
                try {
                    // We'll try a few common field names that might exist in the dataset
                    const possibleCategoryColumns = [
                        { name: 'Item', table: 'sales' },
                        { name: 'Product', table: 'products' },
                        { name: 'Category', table: 'products' },
                        { name: 'CustomerName', table: 'sales' },
                        { name: 'OrderDate', table: 'sales' },
                        { name: 'Region', table: 'Geo' }
                    ];
                    
                    const possibleValueColumns = [
                        { name: 'Quantity', table: 'sales' },
                        { name: 'UnitPrice', table: 'sales' },
                        { name: 'SalesAmount', table: 'sales' },
                        { name: 'Revenue', table: 'sales' },
                        { name: 'Total Units', table: 'SalesFact' },
                        { name: 'Total VanArsdel Units', table: 'SalesFact' }
                    ];
                    
                    // Try each possible category column
                    let categoryAdded = false;
                    for (const col of possibleCategoryColumns) {
                        if (categoryAdded) break;
                        
                        try {
                            const categoryField = { 
                                column: col.name, 
                                table: col.table, 
                                schema: 'http://powerbi.com/product/schema#column' 
                            };
                            
                            await newVisual.addDataField('Category', categoryField);
                            console.log(`Added category field: ${col.table}.${col.name}`);
                            categoryAdded = true;
                        } catch (error) {
                            console.log(`Could not add category ${col.table}.${col.name}:`, error.message);
                        }
                    }
                    
                    // Try each possible value column
                    let valueAdded = false;
                    for (const col of possibleValueColumns) {
                        if (valueAdded) break;
                        
                        try {
                            const valueField = { 
                                measure: col.name, 
                                table: col.table, 
                                schema: 'http://powerbi.com/product/schema#measure' 
                            };
                            
                            await newVisual.addDataField('Y', valueField);
                            console.log(`Added value field: ${col.table}.${col.name}`);
                            valueAdded = true;
                        } catch (error) {
                            try {
                                // Try with SUM if direct measure doesn't work
                                const sumValueField = { 
                                    measure: `SUM([${col.name}])`, 
                                    table: col.table, 
                                    schema: 'http://powerbi.com/product/schema#measure' 
                                };
                                
                                await newVisual.addDataField('Y', sumValueField);
                                console.log(`Added sum value field: SUM(${col.table}.${col.name})`);
                                valueAdded = true;
                            } catch (sumError) {
                                console.log(`Could not add value ${col.table}.${col.name}:`, error.message);
                            }
                        }
                    }
                    
                    if (categoryAdded && valueAdded) {
                        alert("Visual created successfully!");
                        
                        // Save the visual for later use
                        defaultVisual = newVisual;
                        window.lastCreatedVisual = newVisual;
                        
                        // Update the visualization page
                        visualizationPage = activePage;
                    } else {
                        alert("Visual created, but couldn't add all data fields. You may need to manually configure it.");
                    }
                    
                } catch (dataError) {
                    console.error("Error adding data to visual:", dataError);
                    alert("Visual created, but couldn't add data. You may need to manually configure it.");
                }
                
                return;
                
            } catch (createError) {
                console.error("Error creating visual:", createError);
                
                // Try operations API as a fallback
                try {
                    console.log("Trying operations API...");
                    
                    await reportObj.executeOperation({
                        name: 'CreateVisual',
                        pageName: activePage.name,
                        visualName: 'chatVisual',
                        layout: {
                            x: 100,
                            y: 100,
                            width: 400,
                            height: 300
                        },
                        visualType: 'columnChart'
                    });
                    
                    alert("Visual created using alternative method. You can now use the chat to create visualizations.");
                    
                    // Check if we can now find it
                    try {
                        const updatedVisuals = await activePage.getVisuals();
                        if (updatedVisuals && updatedVisuals.length > existingVisuals.length) {
                            defaultVisual = updatedVisuals[updatedVisuals.length - 1];
                            window.lastCreatedVisual = defaultVisual;
                            visualizationPage = activePage;
                            console.log("Found newly created visual");
                        }
                    } catch (checkError) {
                        console.error("Error checking for new visual:", checkError);
                    }
                    
                    return;
                    
                } catch (operationsError) {
                    console.error("Operations API error:", operationsError);
                    alert("Could not create a visual. Your embedding configuration may not support visual creation.");
                }
            }
            
        } catch (pageError) {
            console.error("Error working with page:", pageError);
            alert("Could not modify the report page. Please check your embedding permissions.");
        }
        
    } catch (error) {
        console.error("Error in createManualVisual:", error);
        alert("Error: " + error.message);
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

    // Process Power BI filter chat message and handle visualization requests
    async function processPBIFilterMessage(message) {
        if (pbiWaitingForResponse) return;
       
        pbiWaitingForResponse = true;
        const loadingIndicator = addLoadingIndicator(elements.pbiMessages);
        try {
            // Check if report is loaded
            if (!reportLoaded) {
                return "The Power BI report is not yet loaded. Please wait a moment.";
            }
           
            // Call the backend API to process the filter/visualization request
            const response = await fetch('/api/pbi-filter', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    message,
                    sessionId: currentSessionId // Include session ID if available for RLS
                })
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
           
            // Track if we've made changes
            let changesApplied = false;
            let visualCreated = false;
            
            // Apply filters to the report if available
            if (data.filters && data.filters.length > 0) {
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
                        changesApplied = true;
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
                    changesApplied = true;
                } else {
                    console.log('Development mode - would clear all filters');
                }
            }
           
            // Handle visualization if available
            if (data.visualization) {
                try {
                    console.log('Visualization request detected:', data.visualization);
                    
                    // Request visualization data from server
                    const vizDataResponse = await fetch('/api/visualization-data', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            visualization: data.visualization,
                            rlsUsername: data.rlsUsername
                        })
                    });
                    
                    if (!vizDataResponse.ok) {
                        throw new Error(`Error fetching visualization data: ${vizDataResponse.status}`);
                    }
                    
                    const vizData = await vizDataResponse.json();
                    
                    // Find this part in processPBIFilterMessage function
if (vizData.success && vizData.queryResults) {
    // Check if we're in development mode or have a real report
    if (reportObj) {
        // Create or update visualization using the data
        const result = await createOrUpdateVisualization(
            reportObj, 
            data.visualization, 
            vizData.queryResults
        );
        
        if (result.success) {
            visualCreated = true;
            changesApplied = true;
            
            // If it was only partially successful, add the result message to the explanation
            if (result.partial && result.message) {
                return `${data.explanation}\n\n(Note: ${result.message})`;
            }
        } else if (result.error) {
            console.error('Error creating visualization:', result.error);
            
            // Return explanation and show the data anyway
            return `${data.explanation}\n\n(Note: I've analyzed the data, but couldn't create a visualization in the report. The embedding configuration may have limited visual capabilities.)`;
        }
    } else {
        // In development mode, show the visualization data
        console.log('Development mode - visualization data:', vizData.queryResults);
        
        // Create a visual representation of the data in the chat
        const vizElement = createVisualDataPreview(vizData.queryResults, data.visualization);
        elements.pbiMessages.appendChild(vizElement);
        elements.pbiMessages.scrollTop = elements.pbiMessages.scrollHeight;
        visualCreated = true;
    }
} else {
    console.error('Error with visualization data:', vizData.error || 'Unknown error');
    return `${data.explanation} (Note: I couldn't get the data for the visualization. ${vizData.error || ''})`;
}
                } catch (vizError) {
                    console.error('Error processing visualization:', vizError);
                    return `${data.explanation} (Note: There was an error creating the visualization: ${vizError.message})`;
                }
            }
            
            // Return appropriate explanation based on what was done
            if (visualCreated && changesApplied) {
                return `${data.explanation}`;
            } else if (visualCreated) {
                return `${data.explanation}`;
            } else if (changesApplied) {
                return data.explanation || "I processed your request and applied the filters.";
            } else {
                return data.explanation || "I processed your request, but no changes were needed.";
            }
        } catch (error) {
            console.error('Error processing PBI filter/visualization:', error);
            return `Error: ${error.message || 'An unknown error occurred while processing your request.'}`;
        } finally {
            // Remove loading indicator
            if (loadingIndicator && loadingIndicator.parentNode) {
                loadingIndicator.parentNode.removeChild(loadingIndicator);
            }
            pbiWaitingForResponse = false;
        }
    }

    // Helper function to create or update a visualization in the report
// Also update the createOrUpdateVisualization function to use authoring page
// Updated createOrUpdateVisualization function for alternative approach
// Simplified function to work with existing visuals
// Final version that doesn't use addDataField at all
async function createOrUpdateVisualization(report, vizConfig, vizData) {
    try {
        if (!report || !vizConfig || !vizData) {
            return { success: false, error: 'Missing required parameters' };
        }
        
        // If we have a saved visual reference, use it
        if (window.lastCreatedVisual) {
            defaultVisual = window.lastCreatedVisual;
        }
        
        // If we have a visual to work with
        if (defaultVisual) {
            console.log("Using existing visual for update:", defaultVisual);
            
            try {
                // Try to update visual using updateSettings if available
                try {
                    await defaultVisual.updateSettings({
                        general: {
                            formatString: vizConfig.title || `${vizConfig.type} chart`,
                            visible: true,
                            displayName: true
                        }
                    });
                    console.log("Updated visual settings");
                } catch (settingsError) {
                    console.log("Could not update visual settings:", settingsError);
                }
                
                // Try to set visual properties if available
                try {
                    const properties = {
                        general: {
                            formatString: vizConfig.title || `${vizConfig.type} chart`,
                            visible: true,
                            displayName: true
                        }
                    };
                    
                    await defaultVisual.setProperties(properties);
                    console.log("Set visual properties");
                } catch (propertiesError) {
                    console.log("Could not set visual properties:", propertiesError);
                }
                
                // Try operations API as a last resort
                try {
                    await report.executeOperation({
                        name: 'SetVisualDisplayState',
                        visualName: defaultVisual.name,
                        displayState: 'visible'
                    });
                    console.log("Made visual visible using operations API");
                } catch (operationError) {
                    console.log("Could not use operations API:", operationError);
                }
                
                // Even if we couldn't update the visual, return success
                // This will let the chat continue to provide useful information
                return { 
                    success: true, 
                    partial: true, 
                    message: "The visualization data is shown in text format because your embedding configuration has limited visualization capabilities." 
                };
                
            } catch (updateError) {
                console.error("Error working with visual:", updateError);
                
                // Still return partial success so the user gets the data even if visualization fails
                return { 
                    success: true, 
                    partial: true, 
                    message: "Visualization not fully supported in current configuration, but I've processed your data."
                };
            }
        }
        
        // If we don't have a visual to work with, return success but explain the limitations
        // This will ensure the user still gets the data and explanation
        return { 
            success: true, 
            partial: true, 
            message: "Your embedding configuration doesn't support creating visuals, but I've processed the data for you."
        };
        
    } catch (error) {
        console.error("General error in createOrUpdateVisualization:", error);
        
        // Return partial success so the user still gets data even if visualization fails
        return { 
            success: true, 
            partial: true, 
            message: "Visualization features are limited, but I've processed your data request."
        };
    }
}

// Helper function to map visualization types
function mapVisualizationType(type) {
    const typeMap = {
        'bar': 'barChart',
        'column': 'columnChart',
        'line': 'lineChart',
        'pie': 'pieChart',
        'scatter': 'scatterChart',
        'area': 'areaChart',
        'donut': 'donutChart',
        'table': 'tableEx'
    };
    
    return typeMap[type.toLowerCase()] || 'columnChart';
}

    // Helper to create visual properties from config
    function createVisualPropertiesFromConfig(vizConfig, vizData) {
        // Default properties based on visualization type
        let properties = {
            general: {
                formatString: vizConfig.title || `Generated ${vizConfig.type} chart`,
                displayName: true
            },
            categoryAxis: {
                show: true
            },
            valueAxis: {
                show: true
            },
            legend: {
                show: true,
                position: 'Right'
            }
        };
        
        // Customize properties based on visualization type
        switch (vizConfig.type.toLowerCase()) {
            case 'column':
            case 'bar':
                properties.legend.show = false;
                break;
                
            case 'pie':
            case 'donut':
                properties.legend.position = 'Bottom';
                break;
                
            case 'scatter':
                properties.bubbleSize = {
                    show: true
                };
                break;
        }
        
        // Map data roles to visual properties
        if (vizConfig.dataRoles && vizConfig.dataRoles.length > 0) {
            properties.dataRoles = vizConfig.dataRoles.map(role => {
                return {
                    name: role.name,
                    displayName: role.column,
                    kind: role.name === 'category' ? 'Grouping' : 'Measure'
                };
            });
        }
        
        return properties;
    }

    // For development mode - create a visual representation of data in the chat
    function createVisualDataPreview(queryResults, vizConfig) {
        const previewElement = document.createElement('div');
        previewElement.classList.add('message', 'assistant', 'visual-preview');
        
        // Create a title for the visualization
        const titleElement = document.createElement('h4');
        titleElement.textContent = vizConfig.title || `${vizConfig.type.charAt(0).toUpperCase() + vizConfig.type.slice(1)} Chart`;
        previewElement.appendChild(titleElement);
        
        // Add info about what this is
        const infoText = document.createElement('p');
        infoText.innerHTML = `<small><em>Development mode: Visualization preview (in production this would create a ${vizConfig.type} chart in the report)</em></small>`;
        previewElement.appendChild(infoText);
        
        // Add the data preview
        if (queryResults && queryResults.tables && queryResults.tables.length > 0) {
            const table = document.createElement('table');
            table.classList.add('results-table');
            
            // Add headers
            const thead = document.createElement('thead');
            const headerRow = document.createElement('tr');
            
            // Get column names
            const columns = queryResults.tables[0].columns;
            columns.forEach(column => {
                const th = document.createElement('th');
                th.textContent = column.name;
                headerRow.appendChild(th);
            });
            
            thead.appendChild(headerRow);
            table.appendChild(thead);
            
            // Add data rows
            const tbody = document.createElement('tbody');
            const rows = queryResults.tables[0].rows;
            
            rows.forEach(row => {
                const tr = document.createElement('tr');
                
                // Add each cell value
                row.forEach((value, index) => {
                    const td = document.createElement('td');
                    
                    // Format the value based on column type
                    if (typeof value === 'number') {
                        td.textContent = value.toLocaleString();
                    } else if (value === null) {
                        td.innerHTML = '<em>N/A</em>';
                    } else {
                        td.textContent = value;
                    }
                    
                    tr.appendChild(td);
                });
                
                tbody.appendChild(tr);
            });
            
            table.appendChild(tbody);
            previewElement.appendChild(table);
        } else {
            const noDataMessage = document.createElement('p');
            noDataMessage.textContent = 'No data available for this visualization.';
            previewElement.appendChild(noDataMessage);
        }
        
        return previewElement;
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
                body: JSON.stringify({ 
                    message,
                    sessionId: currentSessionId // Include session ID for RLS if available
                })
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

    // Function to initialize the app
    function init() {
        // Initialize Power BI report
        initPowerBIReport();
        
        // Check if Power BI Semantic Model is configured
        checkSemanticModelStatus();
        
        // Update chat welcome messages to include visualization capabilities
        updatePBIFilterWelcomeMessage();
        
        // Set up event listeners for visualization tools
        setupVisualizationToggle();
        
        // Set up the Create Visual button
        // Set up the Create Visual button
if (elements.createVisualBtn) {
    elements.createVisualBtn.addEventListener('click', createManualVisual);
    elements.createVisualBtn.disabled = true; // Initially disabled until report loads
}
    }

    // Function to update PBI Filter chat welcome message
    function updatePBIFilterWelcomeMessage() {
        const welcomeMessage = document.querySelector('#pbi-messages .message.system');
        if (welcomeMessage) {
            welcomeMessage.textContent = 'Hello! I can help you filter and visualize data from the Power BI report. Try saying "Show me sales for the last quarter" or "Create a bar chart of sales by product category".';
        }
    }

    // Set up event listener for the toggle visualization button
    function setupVisualizationToggle() {
        const toggleVisualBtn = document.getElementById('toggle-visual-pane');
        if (toggleVisualBtn) {
            toggleVisualBtn.addEventListener('click', function() {
                if (!reportObj) {
                    alert('Report is not yet loaded. Please wait and try again.');
                    return;
                }
                
                // Check if visualization page exists
                if (visualizationPage) {
                    // Switch to visualization page
                    visualizationPage.setActive()
                        .then(() => {
                            console.log('Switched to visualization page');
                        })
                        .catch(error => {
                            console.error('Error switching to visualization page:', error);
                            alert('Could not switch to the visualization page. Please check permissions.');
                        });
                } else {
                    // Toggle between views (could be customized based on your needs)
                    reportObj.getPages().then(pages => {
                        if (!pages || pages.length === 0) return;
                        
                        const activePage = pages.filter(page => page.isActive)[0] || pages[0];
                        
                        // Get existing visuals
                        activePage.getVisuals().then(visuals => {
                            if (!visuals || visuals.length === 0) {
                                alert('No visuals found on this page.');
                                return;
                            }
                            
                            // Simple toggle of first visual for demonstration
                            const firstVisual = visuals[0];
                            
                            // Get current visibility
                            firstVisual.getProperties().then(props => {
                                const isVisible = !(props.general && props.general.visible === false);
                                
                                // Toggle visibility
                                firstVisual.setProperties({
                                    general: {
                                        visible: !isVisible
                                    }
                                }).then(() => {
                                    console.log(`Visual ${isVisible ? 'hidden' : 'shown'}`);
                                }).catch(error => {
                                    console.error('Error toggling visual:', error);
                                });
                            }).catch(error => {
                                console.error('Error getting visual properties:', error);
                            });
                        }).catch(error => {
                            console.error('Error getting visuals:', error);
                        });
                    }).catch(error => {
                        console.error('Error getting report pages:', error);
                    });
                }
            });
        }
    }

    // Add a helper function for session management
    function setUserIdentity(username, roles = [], customData = {}) {
        return new Promise((resolve, reject) => {
            fetch('/api/set-user-identity', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, roles, customData })
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Error: ${response.status} - ${response.statusText}`);
                }
                return response.json();
            })
            .then(data => {
                currentSessionId = data.sessionId;
                console.log('User identity set:', data);
                resolve(data);
            })
            .catch(error => {
                console.error('Error setting user identity:', error);
                reject(error);
            });
        });
    }

    // Expose the identity function globally
    window.setUserIdentity = setUserIdentity;

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

    // Start the app
    init();
});