# Power BI Chat Application

A modern web application that combines Power BI reports with chat interfaces powered by Azure OpenAI.

## Features

- Power BI report embedding
- Natural language to Power BI filter conversion
- General AI assistant powered by Azure OpenAI
- Modern, responsive UI

## Project Structure

- `/public` - Frontend files (HTML, CSS, JavaScript)
- `server.js` - Express backend server
- `.env` - Configuration for Azure OpenAI and Power BI (you need to create this)
- `package.json` - Project dependencies

## Setup Instructions

1. **Clone the repository**

2. **Install dependencies**
   ```
   npm install
   ```

3. **Configure environment variables**
   
   Copy `.env.template` to `.env` and add your credentials:
   ```
   cp .env.template .env
   ```
   
   Then edit the `.env` file with your own credentials:
   - Azure OpenAI credentials
   - Power BI credentials and report ID

4. **Start the server**
   ```
   npm start
   ```

5. **Access the application**
   
   Open your browser and go to:
   ```
   http://localhost:3000
   ```

## Azure OpenAI Setup

1. Create an Azure OpenAI resource in your Azure portal
2. Deploy a model (e.g., GPT-4 or GPT-3.5-Turbo)
3. Get the API key, endpoint, and deployment name
4. Add these to your .env file

## Power BI Setup

For a full production implementation:

1. Register an application in Azure AD
2. Set up proper permissions for Power BI API
3. Get client ID, client secret, and tenant ID
4. Create a Power BI workspace and report
5. Get the workspace ID and report ID
6. Add all these details to your .env file

## Development Notes

- The current implementation includes placeholder code for Power BI embedding
- In a production environment, you would implement proper token acquisition and embed the report
- The Azure OpenAI integration is fully functional once you add your credentials

## Power BI Filter Examples

Try these natural language queries in the PBI Filter Assistant:

- "Show me sales for the last quarter"
- "Filter to the top 5 products by revenue"
- "Show only data from the East region"
- "Clear all filters"

## Customization

You can customize the system prompt for the filter generation in `server.js` to match your specific Power BI report structure.
# pbiembeddedsemanticmodel
