require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { sendDeliveryReceipt } = require('../app/services/emailService');
const fs = require('fs');
const path = require('path');

async function testEmail() {
    try {
        const testEmail = process.argv[2];
        if (!testEmail) {
            console.error('Usage: node check_email.js <email>');
            process.exit(1);
        }

        console.log(`📧 Testing email to: ${testEmail}`);

        // Mock Delivery Info
        const deliveryInfo = {
            albaranNum: 'TEST-999',
            clientName: 'Cliente Prueba',
            total: '150.50',
            fecha: new Date().toLocaleDateString('es-ES')
        };

        // Create a dummy PDF buffer
        const pdfBuffer = Buffer.from('PDF Dummy Content');

        console.log('Sending email...');
        const result = await sendDeliveryReceipt(testEmail, pdfBuffer, deliveryInfo);

        console.log('✅ Email sent successfully!');
        console.log('Result:', result);

    } catch (error) {
        console.error('❌ Error sending email:', error);
    } finally {
        // Force exit to close connections
        process.exit(0);
    }
}

testEmail();
