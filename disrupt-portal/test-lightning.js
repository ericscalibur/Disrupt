const lightning = require('./lightning-service');

(async () => {
  try {
    console.log("Testing Lightning Service...");
    // Mock token - replace with real token from your auth flow
    const mockToken = "your_test_access_token"; 
    const balance = await lightning.getBalance(mockToken);
    console.log("Balance:", balance);
  } catch (err) {
    console.error("Test failed:", err.message);
  }
})();