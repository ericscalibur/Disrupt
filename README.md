# Disrupt Portal - Lightning Network Business Management Platform

A comprehensive Lightning Network-enabled business management platform for handling payments, team management, supplier relationships, and financial operations with built-in El Salvador tax withholding support.

## 🚀 Quick Start Guide

### Prerequisites

Before you begin, ensure you have:
- **Node.js** (v14 or higher) - [Download here](https://nodejs.org/)
- **Git** - [Download here](https://git-scm.com/)
- **Blink API account** - [Sign up at blink.sv](https://blink.sv)

### Step 1: Clone the Repository

```bash
git clone https://github.com/ericscalibur/Disrupt.git
cd Disrupt
```

### Step 2: Install Dependencies

```bash
npm install
```

### Step 3: Environment Configuration

Create a `.env` file in the root directory:

```bash
cp .env.example .env
```

Edit the `.env` file with your configuration:

```env
# JWT Secrets - Generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
ACCESS_TOKEN_SECRET=your-64-character-hex-string-here
REFRESH_TOKEN_SECRET=your-different-64-character-hex-string-here

# Blink API Configuration
BLINK_API_KEY=your-blink-api-key-here

# Tax Lightning Address
TAX_LIGHTNING_ADDRESS=example@blink.sv

# Email Configuration (Optional - for password reset)
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587

# Server Configuration
PORT=3000
NODE_ENV=development
```

### Step 4: Generate Secure JWT Secrets

Run these commands to generate secure secrets:

```bash
# Generate ACCESS_TOKEN_SECRET
node -e "console.log('ACCESS_TOKEN_SECRET=' + require('crypto').randomBytes(64).toString('hex'))"

# Generate REFRESH_TOKEN_SECRET
node -e "console.log('REFRESH_TOKEN_SECRET=' + require('crypto').randomBytes(64).toString('hex'))"
```

Copy the generated strings and replace the placeholders in your `.env` file.

### Step 5: Get Your Blink API Key

1. Visit [blink.sv](https://blink.sv) and create an account
2. Navigate to your dashboard
3. Generate an API key
4. Add the API key to your `.env` file as `BLINK_API_KEY`

### Step 6: Start the Local Server

```bash
npm start
```

**🚀 The server will start and the application will be available at:**
**http://localhost:3000**

Open your web browser and navigate to `http://localhost:3000` to access the Disrupt Portal interface.

## 🇸🇻 El Salvador Tax Withholding

The system includes built-in support for El Salvador's payroll tax structure:

### Employee Deductions (10.25%):
- **ISSS Employee**: 3%
- **AFP Employee**: 7.25%

### Employer Contributions (16.25%):
- **ISSS Employer**: 7.5%
- **AFP Employer**: 8.75%

**Total Tax Withholding: 26.5%**

When processing employee payments with tax withholding:
- Employee receives 73.5% of the payment
- 26.5% is automatically sent to the configured tax Lightning address
- All deductions are properly tracked and logged

## 🎯 Key Features

### Lightning Network Payments
- Send payments via Lightning Network
- Automatic Lightning address resolution
- Real-time balance tracking
- Transaction history and audit trails

### Tax Withholding
- Automatic El Salvador tax calculations
- Dual Lightning payments (employee + tax)
- Detailed tax breakdown display
- Configurable tax Lightning address

### Team Management
- Role-based access control (Admin, Manager, Employee)
- Department-based permissions
- Employee payment processing
- Team member profiles with Lightning addresses

### Supplier Management
- Supplier database with Lightning addresses
- Payment workflows
- Company and contact tracking

### Financial Operations
- Draft payment system with approval workflows
- Transaction tracking and history
- Real-time BTC/USD exchange rates
- Payment authorization by role
- CSV batch payment processing

## 🔧 Configuration Options

### Email Setup (Optional)

For password reset functionality, configure email in `.env`:

**Gmail Setup:**
1. Enable 2-Factor Authentication on your Google account
2. Generate an App Password: Google Account → Security → 2-Step Verification → App passwords
3. Use the 16-character app password (not your regular password)

### Tax Lightning Address

Update the tax destination address in `.env`:
```env
TAX_LIGHTNING_ADDRESS=your-tax-wallet@blink.sv
```

### Port Configuration

Change the server port in `.env`:
```env
PORT=3000
```

## 📁 Project Structure

```
Disrupt/
├── disrupt-portal/
│   ├── server.js              # Main server application
│   ├── public/                # Frontend assets
│   │   ├── index.html         # Main application UI
│   │   ├── script.js          # Frontend JavaScript
│   │   ├── style.css          # Application styling
│   │   └── favicon.png        # Application icon
│   └── data/                  # JSON data storage (auto-created)
│       ├── users.json         # User accounts
│       ├── drafts.json        # Payment drafts
│       ├── suppliers.json     # Supplier directory
│       ├── transactions.json  # Transaction history
│       ├── departments.json   # Department structure
│       └── refresh_tokens.json # Token storage
├── package.json               # Dependencies and scripts
├── .env                       # Environment configuration
├── .env.example              # Environment template
├── .gitignore                # Git ignore rules
└── README.md                 # This file
```

## 🔒 Security Features

- JWT Authentication with short-lived access tokens
- Refresh token rotation for enhanced security
- Role-based access control throughout the application
- Content Security Policy headers
- Input validation and sanitization
- Secure cookie handling for sensitive data
- Environment variable protection for secrets

## 🐛 Troubleshooting

### Common Issues

**"ACCESS_TOKEN_SECRET environment variable is not defined"**
- Ensure your `.env` file exists in the root directory
- Verify JWT secrets are properly generated and set
- Restart the server after updating `.env`

**"Cannot find module" errors**
- Run `npm install` to install dependencies
- Ensure you're in the correct directory

**Login fails**
- Check if the server is running on the correct port
- Verify default accounts haven't been modified
- Clear browser storage and try again

**Lightning payments fail**
- Verify Blink API key is valid and properly set
- Check Lightning address format
- Ensure sufficient wallet balance in your Blink account

**Tax payments not working**
- Verify `TAX_LIGHTNING_ADDRESS` is set in `.env`
- Ensure the tax Lightning address is valid
- Check server logs for detailed error messages

### Debug Mode

Set detailed logging in `.env`:
```env
NODE_ENV=development
```

## 🚀 Deployment to Production

### Environment Variables
1. Set `NODE_ENV=production`
2. Use secure HTTPS connections only
3. Generate new, secure JWT secrets (256-bit recommended)
4. Use production-grade SMTP service
5. Monitor Lightning wallet balance regularly

### Security Checklist
- [ ] Strong JWT secrets generated
- [ ] HTTPS enabled
- [ ] Proper CORS origins configured
- [ ] Regular backups of data files
- [ ] Monitor server logs
- [ ] Update dependencies regularly

## 📊 Usage Guide

### For Administrators
1. Login with admin credentials
2. Manage team members and departments
3. Approve payment drafts from all departments
4. Process batch payments via CSV upload
5. Monitor Lightning wallet balance and transactions

### For Managers
1. Access department-specific payment drafts
2. Approve payments within your department
3. Manage supplier relationships
4. Process individual payments to suppliers

### For Employees
1. Create payment drafts for approval
2. View approved transactions
3. Submit payment requests with proper documentation

### Payment Workflow
1. **Draft Creation** - Employee creates payment request
2. **Manager Review** - Department manager reviews and approves
3. **Admin Authorization** - Final approval for large amounts
4. **Lightning Payment** - Automatic processing via Blink API
5. **Tax Withholding** - Automatic calculation and separate payment (if applicable)
6. **Transaction Logging** - Complete audit trail

## 🤝 Support

If you encounter issues:

1. **Check the logs** - Server logs provide detailed error information
2. **Verify configuration** - Ensure all environment variables are properly set
3. **Test with default accounts** - Use the provided test accounts first
4. **Check Lightning balance** - Ensure sufficient funds in your Blink wallet

## 📝 License

This project is licensed under the ISC License.

---

**Built with ⚡ Lightning Network technology for modern business payments in El Salvador.**

For questions or support, please open an issue on GitHub.
