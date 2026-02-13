# Disrupt Portal

A comprehensive Lightning Network-enabled business management platform for handling payments, team management, supplier relationships, and financial operations.

## 🚀 Features

### 🔐 Authentication & Authorization
- **JWT-based authentication** with access and refresh tokens
- **Role-based access control** (Admin, Manager, Employee)
- **Department-based permissions** for data access
- **Secure session management** with automatic token refresh
- **Password reset functionality** via email

### ⚡ Lightning Network Integration
- **Bitcoin Lightning payments** via Blink API
- **Real-time balance tracking** in satoshis
- **Lightning address support** for easy payments
- **Invoice generation and payment** processing
- **Transaction history** with local and remote data
- **Batch payment processing** for multiple recipients

### 👥 Team Management
- **User management** with role assignments
- **Department organization** and access control
- **Team member profiles** with Lightning addresses
- **Employee onboarding** and offboarding workflows

### 🏢 Supplier Management
- **Supplier database** with contact information
- **Lightning address integration** for payments
- **Supplier payment workflows** with approval processes
- **Company and contact tracking**

### 📊 Financial Operations
- **Draft payment system** with approval workflows
- **Transaction tracking** and history
- **Real-time BTC/USD exchange rates**
- **Payment authorization** by role
- **Batch CSV payment processing**
- **Financial reporting** and audit trails

### 💼 Business Workflows
- **Approval workflows** for payments
- **Department-specific access** to financial data
- **Audit logging** for all transactions
- **CSV import/export** for batch operations

## 🛠️ Technology Stack

### Backend
- **Node.js** with Express.js framework
- **JWT** for authentication and authorization
- **Blink API** for Lightning Network integration
- **File-based JSON storage** for data persistence
- **Helmet.js** for security headers
- **CORS** for cross-origin requests

### Frontend
- **Vanilla JavaScript** with modern ES6+ features
- **Responsive CSS** with dark/light theme support
- **PapaParse** for CSV processing (loaded from CDN)
- **Font Awesome** icons for UI elements

### Security
- **Content Security Policy** (CSP) headers
- **HTTP-only cookies** for refresh tokens
- **Token rotation** for enhanced security
- **Environment variable** configuration
- **Input validation** and sanitization

## 📋 Prerequisites

- **Node.js** (v14 or higher)
- **npm** or **yarn** package manager
- **Blink API account** with API keys
- **SMTP server** for email functionality (optional)

## 🚀 Quick Start

### 1. Clone the Repository
```bash
git clone <repository-url>
cd disrupt
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Environment Configuration
Create a `.env` file in the root directory:
```env
# JWT Secrets
ACCESS_TOKEN_SECRET=your-access-token-secret-here
REFRESH_TOKEN_SECRET=your-refresh-token-secret-here

# Blink API Configuration
BLINK_API_KEY=your-blink-api-key-here

# Email Configuration (Optional)
EMAIL_USER=your-email@example.com
EMAIL_PASS=your-email-password
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587

# Server Configuration
PORT=3000
NODE_ENV=development
```

### 4. Initialize Data Files
The application will automatically create the required data files on first run:
- `data/users.json` - User accounts and profiles
- `data/drafts.json` - Payment drafts and approvals
- `data/suppliers.json` - Supplier information
- `data/transactions.json` - Local transaction history
- `data/departments.json` - Department structure
- `data/refresh_tokens.json` - Secure token storage

### 5. Start the Server
```bash
npm start
```

The application will be available at `http://localhost:3000`

## 👤 Default User Accounts

The system comes with pre-configured test accounts:

| Role | Email | Password | Department |
|------|-------|----------|------------|
| Admin | ericscalibur@disrupt.com | 9555 | Executive |
| Manager | quentin@disrupt.com | 1234 | Accounting |
| Employee | joe@disrupt.com | 1234 | Engineering |

## 🎯 Usage Guide

### For Administrators
1. **Login** with admin credentials
2. **Manage team members** - add, edit, remove users
3. **Configure departments** and role assignments
4. **Approve payment drafts** from all departments
5. **Process batch payments** via CSV upload
6. **Monitor Lightning wallet balance** and transactions

### For Managers
1. **Access department-specific** payment drafts
2. **Approve payments** within your department
3. **Manage supplier relationships**
4. **Process individual payments** to suppliers
5. **View transaction history** for your department

### For Employees
1. **Create payment drafts** for approval
2. **View approved transactions**
3. **Access supplier directory**
4. **Submit payment requests** with proper documentation

### Payment Workflows
1. **Draft Creation** - Employee creates payment request
2. **Manager Review** - Department manager reviews and approves
3. **Admin Authorization** - Final approval for large amounts
4. **Lightning Payment** - Automatic processing via Blink API
5. **Transaction Logging** - Complete audit trail

## 🔧 API Endpoints

### Authentication
- `POST /api/login` - User authentication
- `POST /api/refresh` - Token refresh
- `POST /api/logout` - User logout
- `GET /api/me` - Current user profile

### Team Management
- `GET /api/team-members` - List team members
- `PUT /api/team-members/:id` - Update team member
- `DELETE /api/team-members/:id` - Remove team member

### Financial Operations
- `GET /api/drafts` - List payment drafts
- `POST /api/drafts` - Create payment draft
- `PUT /api/drafts/:id` - Update draft status
- `GET /api/transactions` - Transaction history
- `POST /api/transactions` - Create transaction
- `POST /api/batch-payment` - Process batch payments

### Lightning Network
- `GET /api/lightning-balance` - Wallet balance
- `POST /api/pay` - Send Lightning payment
- `POST /api/pay-invoice` - Pay Lightning invoice
- `GET /api/btc-usd-rate` - Current exchange rate

### Supplier Management
- `GET /api/suppliers` - List suppliers
- `POST /api/suppliers` - Add supplier
- `PUT /api/suppliers/:id` - Update supplier
- `DELETE /api/suppliers/:id` - Remove supplier

## 📁 Project Structure

```
disrupt/
├── disrupt-portal/
│   ├── server.js              # Main server application
│   ├── public/                # Frontend assets
│   │   ├── index.html         # Main application UI
│   │   ├── script.js          # Frontend JavaScript
│   │   ├── style.css          # Application styling
│   │   └── favicon.png        # Application icon
│   └── data/                  # JSON data storage
│       ├── users.json         # User accounts
│       ├── drafts.json        # Payment drafts
│       ├── suppliers.json     # Supplier directory
│       ├── transactions.json  # Transaction history
│       ├── departments.json   # Department structure
│       └── refresh_tokens.json # Token storage
├── package.json               # Dependencies and scripts
├── .env                       # Environment configuration
├── .gitignore                # Git ignore rules
└── README.md                 # This file
```

## 🔒 Security Features

- **JWT Authentication** with short-lived access tokens
- **Refresh token rotation** for enhanced security
- **Role-based access control** throughout the application
- **Content Security Policy** headers
- **Input validation** and sanitization
- **Secure cookie handling** for sensitive data
- **Environment variable** protection for secrets
- **Audit logging** for all financial operations

## 🚀 Deployment

### Production Environment
1. Set `NODE_ENV=production` in your environment
2. Use secure HTTPS connections only
3. Configure proper CORS origins
4. Set strong JWT secrets (256-bit recommended)
5. Use production-grade SMTP service
6. Implement proper backup strategies for data files
7. Monitor Lightning wallet balance regularly

### Docker Deployment (Optional)
```dockerfile
FROM node:16-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the ISC License - see the package.json file for details.

## ⚡ Lightning Network Setup

### Blink API Integration
1. Create account at [blink.sv](https://blink.sv)
2. Generate API key in dashboard
3. Add API key to `.env` file
4. Test connection with small transaction

### Lightning Address Format
- Standard format: `username@domain.com`
- Supported providers: Blink, Wallet of Satoshi, Strike, etc.
- Automatic validation in payment forms

## 🆘 Troubleshooting

### Common Issues

**Authentication Errors**
- Check JWT secrets are properly set
- Verify token expiration settings
- Clear browser storage and login again

**Lightning Payment Failures**
- Verify Blink API key is valid
- Check Lightning address format
- Ensure sufficient wallet balance

**File Permission Errors**
- Ensure write permissions to `data/` directory
- Check file ownership and permissions
- Verify disk space availability

**CORS Issues**
- Update allowed origins in server.js
- Check protocol (HTTP vs HTTPS)
- Verify port configuration

### Debug Mode
Set `NODE_ENV=development` for detailed error logging and enhanced debugging information.

## 📊 Monitoring

- Monitor `data/refresh_tokens.json` file size for cleanup
- Track Lightning wallet balance regularly
- Review transaction logs for anomalies
- Monitor server logs for authentication failures

## 🔮 Roadmap

- [ ] PostgreSQL database integration
- [ ] Real-time notifications
- [ ] Advanced reporting dashboard
- [ ] Mobile app support
- [ ] Multi-currency support
- [ ] Advanced audit logging
- [ ] Automated backup system
- [ ] Integration with accounting software

---

**Built with ⚡ Lightning Network technology for the future of business payments.**