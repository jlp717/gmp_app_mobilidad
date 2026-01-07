const axios = require('axios');

async function testLogin(username, password, description) {
    try {
        console.log(`\nTesting: ${description} [${username} / ${password}]`);
        const res = await axios.post('http://localhost:3001/api/auth/login', {
            username,
            password
        });
        console.log('✅ Success:', res.status);
        console.log('   User:', res.data.user.name, '| Role:', res.data.user.role);
        console.log('   Vendor Code:', res.data.user.vendedorCode);
    } catch (error) {
        if (error.response) {
            console.log('❌ Failed (Expected?):', error.response.status, error.response.data.error);
        } else {
            console.log('❌ Error:', error.message);
        }
    }
}

async function run() {
    // 1. Valid Login (GOYO + PIN 9584) - Should Succeed
    await testLogin('GOYO', '9584', 'VALID PIN');

    // 2. Invalid Password (GOYO + 3105) - Should Fail (if PIN is prioritized)
    await testLogin('GOYO', '3105', 'OLD PASSWORD (Should Fail)');

    // 3. User with no Vendor (JAVIER) - Should use password
    // Assuming JAVIER has a password set in APPUSUARIOS, e.g., '1234' or similar. 
    // If not known, we skip or test a known admin.
}

run();
