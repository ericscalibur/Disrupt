# Quick Start Guide - Disrupt Portal

Get up and running with Disrupt Portal in 5 minutes!

## 🚀 One-Command Setup (Recommended)

```bash
git clone https://github.com/ericscalibur/Disrupt.git
cd Disrupt
./install.sh
```

## ⚡ Manual Setup

### 1. Prerequisites
- Node.js 14+ ([download here](https://nodejs.org/))
- Git

### 2. Install
```bash
git clone https://github.com/ericscalibur/Disrupt.git
cd Disrupt
npm install
cp .env.example .env
```

### 3. Generate JWT Secrets
```bash
npm run generate-jwt
```
Copy the output and replace the JWT secrets in your `.env` file.

*looks like this*
ACCESS_TOKEN_SECRET=your-64-character-hex-string-here
REFRESH_TOKEN_SECRET=your-different-64-character-hex-string-here

### 4. Get Blink API Key
1. Sign up at [blink.sv](https://blink.sv)
2. Get your API key from dashboard
3. Add it to `.env`: `BLINK_API_KEY=your-key-here`

### 5. Start Server
```bash
npm start
```

Visit: **http://localhost:3000**

## 👤 Login

| Role | Email | Password |
|------|-------|----------|
| Admin | ericscalibur@disrupt.com | 9555 |
| Manager | quentin@disrupt.com | 1234 |
| Employee | joe@disrupt.com | 1234 |

## 🇸🇻 Tax Withholding

When paying employees, check "Apply Tax Withholding" to automatically:
- Deduct 26.5% for El Salvador taxes (ISSS + AFP)
- Send employee 73.5% of payment
- Send tax portion to configured Lightning address

## 🎯 Key Features

- **Lightning Payments**: Send Bitcoin payments via Lightning Network
- **Tax Compliance**: Automatic El Salvador payroll tax calculations
- **Team Management**: Role-based access (Admin/Manager/Employee)
- **Supplier Management**: Track and pay suppliers
- **Transaction History**: Complete audit trail

## 🔧 Configuration

All settings are in `.env`:
- `BLINK_API_KEY`: Your Blink wallet API key
- `TAX_LIGHTNING_ADDRESS`: Where tax payments go
- Email settings for password reset (optional)

## 🐛 Troubleshooting

**Server won't start?**
- Check `.env` file exists with JWT secrets
- Ensure port 3000 is available

**Login fails?**
- Use exact email/password from table above
- Clear browser cache

**Lightning payments fail?**
- Verify Blink API key in `.env`
- Check wallet balance on blink.sv
- Ensure Lightning addresses are valid

## 📖 Need More Help?

See the full [README.md](README.md) for detailed documentation.

---

**Happy Lightning payments! ⚡**
