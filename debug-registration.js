#!/usr/bin/env node

const fetch = require('node-fetch');

const BASE_URL = 'http://localhost:8333';

async function request(method, path, body = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  const response = await fetch(BASE_URL + path, options);
  const data = await response.json();
  
  return {
    status: response.status,
    data
  };
}

async function debugRegistration() {
  console.log('🔍 Debugging Node Registration Response\n');
  
  try {
    const nodeName = 'debug-registration-' + Date.now();
    const nodeData = {
      name: nodeName,
      capabilities: ['whisper'],
      reputation: 1000,
      location: 'test'
    };
    
    console.log('Sending registration request with data:', nodeData);
    
    const registerRes = await request('POST', '/nodes/register', nodeData);
    
    console.log('Registration response status:', registerRes.status);
    console.log('Registration response data:', JSON.stringify(registerRes.data, null, 2));
    
    if (registerRes.data.node) {
      console.log('✅ Node object exists in response');
      console.log('Node ID:', registerRes.data.node.nodeId);
    } else {
      console.log('❌ No node object in response');
      console.log('Available keys in response:', Object.keys(registerRes.data));
    }
    
  } catch (error) {
    console.error('Error during registration debug:', error.message);
  }
}

debugRegistration();