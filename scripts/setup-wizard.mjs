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
const ask = async (fn) => { const v = await fn(); if (p.isCancel(v)) cancel(); return v }

p.intro('  neuroLoop — setup')

// ── HuggingFace ──────────────────────────────────────────────────────────────
p.note(
  'TRIBE v2 is a gated model on HuggingFace.\n' +
  '\n' +
  '1. Get a token at:  https://huggingface.co/settings/tokens\n' +
  '2. Accept the license at:  https://huggingface.co/facebook/tribev2',
  'HuggingFace'
)

const hfToken = await ask(() => p.password({
  message: 'Paste your HuggingFace token',
}))

// ── Storage ──────────────────────────────────────────────────────────────────
const storageMode = await ask(() => p.select({
  message: 'Where should neuroLoop store uploads and results?',
  options: [
    { value: 'local', label: 'Local',  hint: 'on this machine — simplest, good for a single GPU instance' },
    { value: 's3',    label: 'AWS S3', hint: 'results persist if the instance restarts' },
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
p.note(
  'The agent loop runs on Claude Code and needs an Anthropic API key.\n' +
  '\n' +
  'Get one at:  https://console.anthropic.com/settings/keys',
  'Anthropic'
)

const anthropicKey = await ask(() => p.password({
  message: 'Paste your Anthropic API key',
}))

// ── Image model ───────────────────────────────────────────────────────────────
const imageModel = await ask(() => p.select({
  message: 'Which model should the agent use to generate keyframe images?',
  options: [
    { value: 'openai', label: 'GPT-image-2',            hint: 'OpenAI — best prompt adherence, complex scenes' },
    { value: 'gemini', label: 'Gemini 3.1 Flash Image', hint: 'Google — fast, vivid, good for abstract or stylized frames' },
    { value: 'grok',   label: 'Grok Imagine Image',     hint: 'xAI — highly detailed and photorealistic' },
  ],
}))

let openaiKey = '', geminiKey = '', xaiKey = ''
if (imageModel === 'openai') {
  openaiKey = await ask(() => p.password({
    message: 'OpenAI API key',
    hint: 'platform.openai.com/api-keys',
  }))
} else if (imageModel === 'gemini') {
  geminiKey = await ask(() => p.password({
    message: 'Google Gemini API key',
    hint: 'aistudio.google.com/apikey',
  }))
} else {
  xaiKey = await ask(() => p.password({
    message: 'xAI API key',
    hint: 'console.x.ai',
  }))
}

// ── Video model ───────────────────────────────────────────────────────────────
const videoModel = await ask(() => p.select({
  message: 'Which model should the agent use to generate video segments?',
  options: [
    { value: 'veo',        label: 'Veo 3',              hint: 'Google — highest quality, native audio, 8s clips' },
    { value: 'seeddance',  label: 'Seedance 2.0',       hint: 'ByteDance via Replicate — strong keyframe adherence, 5s clips' },
    { value: 'grok-video', label: 'Grok Imagine Video', hint: 'xAI — high realism, cinematic, 10s clips' },
  ],
}))

let replicateKey = ''
if (videoModel === 'veo' && !geminiKey) {
  geminiKey = await ask(() => p.password({
    message: 'Google Gemini API key',
    hint: 'aistudio.google.com/apikey',
  }))
} else if (videoModel === 'seeddance') {
  replicateKey = await ask(() => p.password({
    message: 'Replicate API key',
    hint: 'replicate.com/account/api-tokens',
  }))
} else if (videoModel === 'grok-video' && !xaiKey) {
  xaiKey = await ask(() => p.password({
    message: 'xAI API key',
    hint: 'console.x.ai',
  }))
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
