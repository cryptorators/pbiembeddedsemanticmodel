# Power BI Chat Interface

A modern web application that combines Power BI embedded analytics with natural language chat interfaces powered by Azure OpenAI. This app allows users to interact with Power BI reports through conversation, applying filters and creating visualizations using natural language.

![Power BI Chat Interface](https://placehold.co/800x400?text=Power+BI+Chat+Interface)

## 🌟 Features

### 💬 Dual Chat Interfaces
- **Filter & Visualization Chat**: Apply filters to the Power BI report and create visualizations directly in the chat
- **General Assistant Chat**: Query the Power BI semantic model using natural language

### 📊 Visualization Capabilities
- Create dynamic charts (bar, column, line, pie, etc.) directly in the chat
- Interactive visualizations rendered with Chart.js based on Power BI data
- Support for multiple data formats and visualization types

### 🔍 Power BI Integration
- Embedded Power BI report with filter pane and navigation controls
- Natural language to DAX query conversion for semantic model analysis
- Row-level security (RLS) support for personalized data access

### 🧠 AI-Powered Features
- Natural language processing via Azure OpenAI
- Intelligent filter and visualization recommendation
- Contextual explanations of data insights

## 🚀 Getting Started

### Prerequisites
- Node.js (v14+)
- Azure subscription with OpenAI service
- Power BI Pro or Premium account
- A Power BI report to embed

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/powerbi-chat-interface.git
   cd powerbi-chat-interface
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   Create a `.env` file with:
   ```
   # Azure OpenAI Configuration
   AZURE_OPENAI_API_KEY=your-openai-api-key
   AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
   AZURE_OPENAI_DEPLOYMENT_NAME=your-deployment-name
   
   # Power BI Configuration
   POWERBI_CLIENT_ID=your-aad-app-id
   POWERBI_CLIENT_SECRET=your-aad-app-secret
   POWERBI_TENANT_ID=your-tenant-id
   POWERBI_WORKSPACE_ID=your-workspace-id
   POWERBI_REPORT_ID=your-report-id
   POWERBI_DATASET_ID=your-dataset-id
   
   # Server Configuration
   PORT=3000
   ```

4. **Start the server**
   ```bash
   node server.js
   ```

5. **Access the application**
   Open your browser and navigate to `http://localhost:3000`

## 💡 Usage Examples

### Filter Chat Examples
- "Show me sales for the last quarter"
- "Filter to products with price greater than $100"
- "Clear all filters"

### Visualization Examples
- "Create a bar chart of sales by product category"
- "Show me a pie chart of revenue by region"
- "Display monthly sales as a line chart"

### Semantic Query Examples
- "What were the total sales last month?"
- "Who are our top 10 customers by revenue?"
- "What's the average order value by product category?"

## 🧩 Key Components

### Frontend
- **index.html**: Main application interface with dual chat panes
- **app.js**: Core client-side logic for chat interfaces and Power BI embedding
- **styles.css**: Styling for the application UI and visualizations

### Backend
- **server.js**: Express server handling API requests and authentication
- Natural language processing via Azure OpenAI
- Power BI embedding and DAX query generation

### Visualization Engine
- Chart.js integration for rendering interactive charts
- Support for various chart types and data formats
- Responsive design for different screen sizes

## 🔧 Technical Details

### Power BI Integration
The application uses the Power BI JavaScript SDK to embed reports and the Power BI REST API to execute DAX queries against semantic models. When a user asks a question, the app:

1. Processes the natural language query using Azure OpenAI
2. Converts it to either a Power BI filter or DAX query
3. Applies filters to the embedded report or executes the query
4. Renders results as tables or visualizations in the chat

### Chat Visualization System
The visualization system:
- Analyzes query results to determine appropriate visualization types
- Transforms data into the format required by Chart.js
- Renders interactive charts with custom styling
- Provides fallback to tabular display when visualization isn't possible

### Row-Level Security
The app supports Power BI row-level security by:
- Managing user identity sessions
- Applying RLS context to embedding tokens and queries
- Supporting custom RLS roles and parameters

## 🛠️ Customization

### Adding New Chart Types
To add support for new visualization types:
1. Add the type mapping in `mapToChartJsType()` function
2. Add chart-specific options in `getChartOptions()` function
3. Update the CSS for the new visualization

### Customizing the UI
The interface can be customized by modifying:
- `styles.css` for visual appearance
- `index.html` for layout and structure
- `app.js` for behavior and interaction patterns

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 👥 Contributing

Contributions are welcome! Please feel free to submit a pull request.

---

## Screenshots

![Filter Chat](https://placehold.co/800x400?text=Filter+Chat+Screenshot)
*Example of the Filter & Visualization Chat interface*

![Visualization in Chat](https://placehold.co/800x400?text=Chart+Visualization+Example)
*Chart visualization rendered directly in the chat interface*

![Semantic Model Query](https://placehold.co/800x400?text=Semantic+Model+Query+Example)
*Semantic model query results with data table*

---

Created with ❤️ using Power BI, Azure OpenAI, and Chart.js