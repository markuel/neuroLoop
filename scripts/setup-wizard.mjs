#!/usr/bin/env node
import * as p from '@clack/prompts'
import { writeFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ENV_PATH = resolve(ROOT, '.env')
const reconfigure = process.argv.includes('--reconfigure')

if (existsSync(ENV_PATH) && !reconfigure) {
  process.exit(0) // setup.sh will source existing .env
}

const cancel = () => { p.cancel('Setup cancelled.'); process.exit(1) }
const ask = async (fn) => { const v = await fn; if (p.isCancel(v)) cancel(); return v }

p.intro('  neuroLoop — configuration')

// ── HuggingFace ──────────────────────────────────────────────────────────────
const hfToken = await ask(() => p.password({
  message: 'HuggingFace token',
  hint: 'huggingface.co/settings/tokens  ·  accept facebook/tribev2 license first',
}))

// ── Storage ──────────────────────────────────────────────────────────────────
const storageMode = await ask(() => p.select({
  message: 'Storage',
  options: [
    { value: 'local', label: 'Local',   hint: 'on this machine — simplest' },
    { value: 's3',    label: 'AWS S3',  hint: 'results persist across restarts' },
  ],
}))

let s3Bucket = '', awsRegion = 'us-east-1', awsKeyId = '', awsSecret = ''
if (storageMode === 's3') {
  const s3 = await ask(() => p.group(
    {
      bucket: () => p.text({ message: 'S3 bucket name' }),
      region: () => p.text({ message: 'AWS region', initialValue: 'us-east-1' }),
      keyId:  () => p.text({ message: 'AWS access key ID' }),
      secret: () => p.password({ message: 'AWS secret access key' }),
    },
    { onCancel: cancel }
  ))
  s3Bucket = s3.bucket; awsRegion = s3.region; awsKeyId = s3.keyId; awsSecret = s3.secret
}

// ── Anthropic ────────────────────────────────────────────────────────────────
const anthropicKey = await ask(() => p.password({
  message: 'Anthropic API key',
  hint: 'console.anthropic.com/settings/keys',
}))

// ── Image model ───────────────────────────────────────────────────────────────
const imageModel = await ask(() => p.select({
  message: 'Image generation model',
  options: [
    { value: 'openai', label: 'GPT-image-2',            hint: 'best prompt adherence' },
    { value: 'gemini', label: 'Gemini 3.1 Flash Image', hint: 'fast, vivid' },
    { value: 'grok',   label: 'Grok Imagine Image',     hint: 'photorealistic' },
  ],
}))

let openaiKey = '', geminiKey = '', xaiKey = ''
if (imageModel === 'openai') {
  openaiKey = await ask(() => p.password({ message: 'OpenAI API key' }))
} else if (imageModel === 'gemini') {
  geminiKey = await ask(() => p.password({ message: 'Google Gemini API key' }))
} else {
  xaiKey = await ask(() => p.password({ message: 'xAI API key' }))
}

// ── Video model ───────────────────────────────────────────────────────────────
const videoModel = await ask(() => p.select({
  message: 'Video generation model',
  options: [
    { value: 'veo',        label: 'Veo 3',              hint: 'Google — 8s clips, best motion' },
    { value: 'seeddance',  label: 'Seedance 2.0',       hint: 'ByteDance via Replicate — 5s clips' },
    { value: 'grok-video', label: 'Grok Imagine Video', hint: 'xAI — 10s clips' },
  ],
}))

let replicateKey = ''
if (videoModel === 'veo' && !geminiKey) {
  geminiKey = await ask(() => p.password({ message: 'Google Gemini API key' }))
} else if (videoModel === 'seeddance') {
  replicateKey = await ask(() => p.password({ message: 'Replicate API key' }))
} else if (videoModel === 'grok-video' && !xaiKey) {
  xaiKey = await ask(() => p.password({ message: 'xAI API key' }))
}

// ── Write .env ────────────────────────────────────────────────────────────────
writeFileSync(ENV_PATH, `# Storage
STORAGE_MODE=${storageMode}

# S3 settings (only used when STORAGE_MODE=s3)
S3_BUCKET=${s3Bucket}
AWS_DEFAULT_REGION=${awsRegion}
AWS_ACCESS_KEY_ID=${awsKeyId}
AWS_SECRET_ACCESS_KEY=${awsSecret}

# TRIBE v2
HF_TOKEN=${hfToken}

# Agent — Claude Code
ANTHROPIC_API_KEY=${anthropicKey}

# Agent — model selection
IMAGE_MODEL=${imageModel}
VIDEO_MODEL=${videoModel}

# Agent — provider API keys
OPENAI_API_KEY=${openaiKey}
GEMINI_API_KEY=${geminiKey}
XAI_API_KEY=${xaiKey}
REPLICATE_API_KEY=${replicateKey}
`)

p.outro('Configuration saved to .env')
