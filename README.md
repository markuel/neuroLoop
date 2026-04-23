<div align="center">

# neuroLoop

**Brain activity visualization dashboard powered by TRIBE v2**

[![License: CC BY-NC 4.0](https://img.shields.io/badge/License-CC%20BY--NC%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc/4.0/)
[![Python 3.11+](https://img.shields.io/badge/python-3.11%2B-blue.svg)](https://www.python.org/downloads/)

</div>

Upload a video, audio clip, or text — neuroLoop runs [TRIBE v2](https://ai.meta.com/research/publications/a-foundation-model-of-vision-audition-and-language-for-in-silico-neuroscience/) to predict fMRI brain responses, then visualizes the results as a 3D brain with real-time region activation scores.

Built on Meta's TRIBE v2 foundation model and the HCP-MMP1 brain atlas.

# Setup Guide:

## Getting a GPU

TRIBE v2 requires a CUDA-capable GPU. [Lambda Cloud](https://cloud.lambda.ai) is one way to get one:

1. Create an account at [cloud.lambda.ai](https://cloud.lambda.ai)
2. Go to **Instances** → **Launch Instance**
3. Pick any GPU type (a single A10 or A100 works fine)
4. Add your SSH key (or create one in the Lambda dashboard under **SSH Keys**)
5. Launch the instance and wait for it to show **Running** under status
6. Copy the lambda IP address from the dashboard and open the terminal to connect:
   ```bash
   ssh -L 5173:localhost:5173 -L 8000:localhost:8000 -i ~/.ssh/<YOUR_SSH_KEY>.pem ubuntu@<YOUR_LAMBDA_INSTANCE_IP>
   ```

Once you're SSH'd into the instance, continue with setup below.

## Instance Setup

```bash
git clone https://github.com/markuel/neuroLoop.git
cd neuroLoop
bash setup.sh
```

`setup.sh` walks you through configuration (HuggingFace token, storage mode) and handles the full install, model download, and server startup.

Once running, open **http://localhost:5173** in your browser.

## AWS S3 setup (only if you chose `s3` storage mode)

Local mode works out of the box — skip this section if the wizard saved `STORAGE_MODE=local`. If you picked S3, you need a bucket the backend can read and write, plus CORS so the browser can PUT uploads directly.

### 1. Create the bucket

AWS Console → **S3** → **Create bucket**. Any region works; note it down — you'll need the exact string (e.g. `us-east-1`) in step 4. Default settings are fine: Block all public access **on**, Bucket owner enforced.

### 2. Add a CORS policy

S3 → your bucket → **Permissions** → **Cross-origin resource sharing (CORS)** → Edit → paste:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "PUT", "POST", "HEAD"],
    "AllowedOrigins": [
      "http://localhost:5173",
      "http://localhost:5174",
      "http://127.0.0.1:5173"
    ],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

The origin must match exactly what you see in your browser's address bar. If you hit the dashboard from another device on your LAN or from a deployed URL, add those origins here too.

### 3. Create an IAM user with S3 access

AWS Console → **IAM** → Users → **Create user** (programmatic access). After creating, open the user → **Permissions** → **Add permissions** → **Create inline policy** → JSON tab → paste:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": "arn:aws:s3:::YOUR-BUCKET-NAME/*"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::YOUR-BUCKET-NAME"
    }
  ]
}
```

Replace `YOUR-BUCKET-NAME`. Note the two resource lines — object-level actions use `/*`, `ListBucket` uses the bare bucket ARN. **Click Save** (easy to miss).

Then **Security credentials** → **Create access key** → Application running outside AWS. Copy the access key ID and secret — the setup wizard will ask for them.

### 4. Give the wizard the values

When you run `bash setup.sh`, pick **AWS S3** at the storage prompt and paste:

- **S3 bucket name** — what you created in step 1
- **AWS region** — the bucket's region (must match exactly)
- **AWS access key ID** and **AWS secret access key** — from step 3

The wizard writes these into `.env`. To change them later, re-run `bash setup.sh --reconfigure`.

### Troubleshooting

- **`403 SignatureDoesNotMatch` on PUT** — the region in `.env` doesn't match the bucket's region. Check the bucket's Properties tab.
- **`403` on HeadObject from the backend** — IAM policy didn't attach correctly. Most common cause: clicked away without hitting Save on the inline policy page. Go back to IAM → Users → *user* → Permissions and confirm the policy is listed.
- **`CORS preflight` error in the browser console** — your browser's origin isn't in the bucket's `AllowedOrigins`. Add whatever you see in the address bar (exact scheme, host, and port).

## Usage

1. Click **Upload Video** or **Paste Text** in the top bar
2. Wait for TRIBE v2 to process (progress bar shows status)
3. View results:
   - **Left panel**: Video playback (or text display)
   - **Right panel**: 3D brain — rotate and zoom with mouse
   - **Timeline**: Scrub through time, play/pause
   - **Bottom panel**: Top 10 activated brain regions at the current timestep, color-coded by functional network

## Architecture

```
Browser (React + Three.js)  ←→  FastAPI (Lambda Cloud GPU)  ←→  AWS S3
```

- **Frontend**: React 19, Vite, Three.js (react-three-fiber), Tailwind CSS, Zustand
- **Backend**: FastAPI serving TRIBE v2 inference + neuroLoop region analysis
- **Storage**: AWS S3 for uploaded media and prediction results

## Citation

This project is built on TRIBE v2. If you use this software, please cite:

```bibtex
@article{dAscoli2026TribeV2,
  title={A foundation model of vision, audition, and language for in-silico neuroscience},
  author={d'Ascoli, St{\'e}phane and Rapin, J{\'e}r{\'e}my and Benchetrit, Yohann and Brookes, Teon and Begany, Katelyn and Raugel, Jos{\'e}phine and Banville, Hubert and King, Jean-R{\'e}mi},
  year={2026}
}
```

## License

This project is licensed under CC-BY-NC-4.0. See [LICENSE](LICENSE) for details.

TRIBE v2 is created by Meta Platforms, Inc. The neuroLoop SDK and dashboard are built on top of TRIBE v2 under the same license terms.
