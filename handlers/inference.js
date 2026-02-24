#!/usr/bin/env node
// IC Mesh Handler: inference
// Runs LLM inference via Ollama API
// Input: JSON on stdin with payload.prompt, payload.model
// Output: JSON on stdout with response text

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const job = JSON.parse(input);
  const { payload } = job;

  const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
  const model = payload.model || 'llama3.1:8b';
  const prompt = payload.prompt || '';

  process.stderr.write(`Inference: ${model} | "${prompt.slice(0, 60)}..."\n`);

  const resp = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false })
  });

  if (!resp.ok) {
    const err = await resp.text();
    console.log(JSON.stringify({ success: false, error: `Ollama error: ${err.slice(0, 200)}` }));
    process.exit(1);
  }

  const data = await resp.json();
  console.log(JSON.stringify({
    success: true,
    data: {
      response: data.response,
      model,
      tokens: data.eval_count || 0,
      durationMs: data.total_duration ? Math.round(data.total_duration / 1e6) : 0
    }
  }));
}

main().catch(e => {
  console.log(JSON.stringify({ success: false, error: e.message }));
  process.exit(1);
});
