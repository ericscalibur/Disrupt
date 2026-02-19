# Quick Start Guide - Disrupt Portal

Get up and running in 5 minutes!

---

## 🚀 Mac / Linux — One Command

```bash
git clone https://github.com/ericscalibur/Disrupt.git
cd Disrupt
./install.sh
```

`install.sh` handles everything: dependencies, Admin account creation, JWT secrets, and `.env` setup.

---

## 🪟 Windows — Manual Setup

```
git clone https://github.com/ericscalibur/Disrupt.git
cd Disrupt
npm install
npm run setup
npm start
```

---

## ⚡ Mac / Linux — Manual Setup

If you prefer not to use `install.sh`:

```bash
git clone https://github.com/ericscalibur/Disrupt.git
cd Disrupt
npm install
npm run setup
npm start
```

---

## 🧙 What `npm run setup` Does

The interactive wizard will prompt you for:

- **Full name**
- **Email** — this is your login
- **Password** — hidden input, min 4 characters
- **Lightning address** — optional, can be added later
- **Blink API key** — optional, can be added to `.env` later

It automatically:
- Creates `.env` from `.env.example`
- Generates and writes secure JWT secrets to `.env`
- Writes your Blink API key to `.env`
- Creates your Admin account in `users.json`
- Initializes all data files to a clean empty state

> **Note:** Only needs to be run once. Running it again on an existing install will warn you before overwriting anything.

---

## 👤 Login

Use the email and password you created during `npm run setup`.

Visit: **http://localhost:3000**

Additional team members can be added by the Admin from the Team page inside the portal.

---

## 🔧 Optional Configuration

Everything critical is handled by `npm run setup`. The only thing you may want to add manually to `.env` afterwards:

**Email (for password reset):**
```env
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
```
For Gmail, use an App Password — Google Account → Security → 2-Step Verification → App passwords.

**Tax Lightning Address (for El Salvador payroll tax):**
```env
TAX_LIGHTNING_ADDRESS=your-tax-wallet@blink.sv
```

---

## 🐛 Troubleshooting

**Setup wizard stalls or behaves oddly?**
- Make sure you're running Node.js v14 or higher: `node -v`
- Try running in a standard terminal (not an IDE terminal)

**Server won't start?**
- Check `.env` exists and has `ACCESS_TOKEN_SECRET` and `REFRESH_TOKEN_SECRET` set
- Make sure port 3000 is free

**Login fails?**
- Use the exact email and password entered during `npm run setup`
- Clear browser cache and try again

**Lightning payments fail?**
- Verify `BLINK_API_KEY` is set correctly in `.env`
- Check your wallet balance at blink.sv
- Make sure Lightning addresses are valid

---

## 📖 Full Documentation

See [README.md](README.md) for complete documentation including features, tax withholding details, deployment, and security.

---

**Happy Lightning payments! ⚡**