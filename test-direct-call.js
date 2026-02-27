#!/usr/bin/env node

// Test the getAvailableJobs function directly in the server context
const http = require('http');

// Make a request to test the endpoint and see if there are any server-side logs
const req = http.request('http://localhost:8333/jobs/available?nodeId=5ef95d698bdfa57a', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Response:', JSON.parse(data));
    process.exit(0);
  });
});

req.on('error', (err) => {
  console.error('Request error:', err);
  process.exit(1);
});

req.end();

// Also test without nodeId
setTimeout(() => {
  const req2 = http.request('http://localhost:8333/jobs/available', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      console.log('Response without nodeId:', JSON.parse(data));
    });
  });

  req2.on('error', (err) => {
    console.error('Request 2 error:', err);
  });

  req2.end();
}, 1000);