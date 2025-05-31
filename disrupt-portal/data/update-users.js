const fs = require('fs');
const crypto = require('crypto');

const users = JSON.parse(fs.readFileSync('users.json', 'utf8'));

users.forEach(user => {
  // Concatenate fields that uniquely identify a user
  const data = `${user.name}|${user.email}|${user.address || user.lightningAddress}`;
  user.id = crypto.createHash('sha256').update(data).digest('hex');
  // Optionally rename 'address' to 'lightningAddress'
  if (user.address) {
    user.lightningAddress = user.address;
    delete user.address;
  }
});

fs.writeFileSync('users.json', JSON.stringify(users, null, 2));
console.log('users.json updated!');
