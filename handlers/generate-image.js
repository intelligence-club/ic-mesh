#!/usr/bin/env node
// IC Mesh Handler: generate-image
// Generates images via Stable Diffusion A1111 API
// Input: JSON on stdin with payload.prompt, width, height, steps, etc.
// Output: JSON on stdout + image file in outputDir

const fs = require('fs');
const path = require('path');

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const job = JSON.parse(input);
  const { payload, outputDir } = job;

  const SD_URL = process.env.SD_URL || process.env.IC_SD_URL || 'http://localhost:7860';

  const params = {
    prompt: payload.prompt || '',
    negative_prompt: payload.negative_prompt || '',
    width: payload.width || 1024,
    height: payload.height || 1024,
    steps: payload.steps || 30,
    cfg_scale: payload.cfg_scale || 5,
    sampler_name: payload.sampler || 'Euler a',
    seed: payload.seed || -1,
    batch_size: 1,
    n_iter: 1
  };

  // Switch model if requested
  if (payload.model) {
    try {
      await fetch(`${SD_URL}/sdapi/v1/options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sd_model_checkpoint: payload.model })
      });
      process.stderr.write(`Switched to model: ${payload.model}\n`);
    } catch (e) {
      process.stderr.write(`Model switch failed: ${e.message}\n`);
    }
  }

  process.stderr.write(`Generating: "${params.prompt.slice(0, 60)}..." (${params.width}x${params.height})\n`);

  const resp = await fetch(`${SD_URL}/sdapi/v1/txt2img`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });

  if (!resp.ok) {
    const err = await resp.text();
    console.log(JSON.stringify({ success: false, error: `SD API error (${resp.status}): ${err.slice(0, 200)}` }));
    process.exit(1);
  }

  const data = await resp.json();
  if (!data.images?.length) {
    console.log(JSON.stringify({ success: false, error: 'No images returned' }));
    process.exit(1);
  }

  // Save image
  const imgPath = path.join(outputDir, 'generated.png');
  fs.writeFileSync(imgPath, Buffer.from(data.images[0], 'base64'));

  console.log(JSON.stringify({
    success: true,
    data: {
      width: params.width,
      height: params.height,
      prompt: params.prompt,
      seed: data.parameters?.seed || params.seed,
      sizeBytes: fs.statSync(imgPath).size
    },
    outputFiles: [imgPath]
  }));
}

main().catch(e => {
  console.log(JSON.stringify({ success: false, error: e.message }));
  process.exit(1);
});
