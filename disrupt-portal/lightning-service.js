const { Alby } = require("@getalby/sdk");

class LightningService {
  constructor() {
    this.client = new Alby({
      clientId: "your-disrupt-app",
      clientSecret: process.env.ALBY_CLIENT_SECRET,
      // Optional: Add redirect URI if using OAuth
      redirectUri:
        process.env.ALBY_REDIRECT_URI || "http://localhost:3000/auth/callback",
    });
  }

  async getBalance(accessToken) {
    try {
      const response = await this.client.getBalance({ accessToken });
      return response.balance; // in satoshis
    } catch (err) {
      console.error("Error fetching balance:", err);
      throw new Error("Failed to get balance");
    }
  }

  async makePayment(accessToken, invoice) {
    try {
      const response = await this.client.sendPayment({
        paymentRequest: invoice,
        accessToken,
      });
      return {
        preimage: response.preimage,
        paymentHash: response.paymentHash,
        amount: response.amount,
      };
    } catch (err) {
      console.error("Payment failed:", err);
      throw new Error("Payment failed");
    }
  }

  async createInvoice(accessToken, amount, memo) {
    try {
      const response = await this.client.createInvoice({
        amount,
        memo,
        accessToken,
      });
      return response.paymentRequest;
    } catch (err) {
      console.error("Invoice creation failed:", err);
      throw new Error("Invoice creation failed");
    }
  }
}

module.exports = new LightningService();
