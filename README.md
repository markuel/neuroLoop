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

Local mode works out of the box — skip this section if the wizard saved `STORAGE_MODE=local`. If you picked S3, you need a bucket to store uploads/results and an IAM user the backend can authenticate as. This walks through it from a fresh AWS account.

### 1. Create the bucket

AWS Console → **S3** → **Create bucket**.

- **Bucket name**: globally unique (e.g. `yourname-neuroloop`). Remember this exact string — the wizard asks for it.
- **AWS Region**: pick one close to you. Write down the code (e.g. `us-east-1`, `us-west-2`). The region in your `.env` must match *exactly*, so if you pick `us-east-2` the setup wizard needs `us-east-2`.
- **Object Ownership**: leave at *ACLs disabled (recommended)* / *Bucket owner enforced*. The app doesn't use ACLs.
- **Block Public Access**: leave all four checkboxes **on**. The app uses presigned URLs — it never needs public access.
- **Bucket Versioning**: off is fine; optional.
- **Default encryption**: SSE-S3 (default) is fine.

Click **Create bucket**.

### 2. Add a CORS policy to the bucket

The browser uploads directly to S3 via a presigned URL, which requires CORS to be configured on the bucket.

S3 → your bucket → **Permissions** → scroll to **Cross-origin resource sharing (CORS)** → **Edit** → paste:

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

Click **Save changes**.

**Important**: `AllowedOrigins` must contain the exact origin (scheme + host + port) your browser shows in the address bar. If you load the dashboard from a LAN IP (e.g. `http://192.168.1.42:5173`), add that here too. `http://` and `https://` are different origins; so are different ports.

### 3. Create an IAM user for the backend

The backend authenticates to S3 using long-lived access keys. Create a dedicated IAM user for this — don't use your root account keys.

AWS Console → **IAM** (search "IAM" in the top bar) → **Users** (left sidebar) → **Create user**.

- **User name**: something obvious, e.g. `neuroloop-app`.
- **Provide user access to the AWS Management Console**: leave **unchecked** — this user is for API access only.
- Click **Next**.

On the **Set permissions** step, pick **Attach policies directly** → skip selecting any of the listed policies (we'll add a custom one next) → **Next** → **Create user**.

You'll land on the Users list. Click the user you just created to open it.

### 4. Attach the S3 permissions policy

Inside the user page → **Permissions** tab → **Add permissions** dropdown → **Create inline policy**.

Click the **JSON** tab and replace whatever's in the editor with:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
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

Replace **both** occurrences of `YOUR-BUCKET-NAME` with your actual bucket name. Note the ARNs:

- Object-level actions (`PutObject`, `GetObject`, `DeleteObject`) target `arn:aws:s3:::bucket/*`
- `ListBucket` targets the bare bucket ARN `arn:aws:s3:::bucket` — no trailing `/*`

Getting these ARNs wrong is the #1 source of silent `403 HeadObject` errors.

Click **Next** → give the policy a name (e.g. `neuroloop-s3-access`) → **Create policy**.

**Important**: after clicking Create policy, verify on the user's Permissions tab that the policy is actually listed. If it's not there, it didn't save — redo this step.

### 5. Create access keys for the user

Still on the user page → **Security credentials** tab → scroll to **Access keys** → **Create access key**.

- **Use case**: select **Application running outside AWS** → **Next**.
- **Description tag**: optional.
- Click **Create access key**.

You'll see the **Access key** (starts with `AKIA…`) and **Secret access key** (random-looking string) exactly once — the secret is never shown again. Copy both now. If you lose them, deactivate that key and create a new one.

### 6. Feed the values into the setup wizard

When you run `bash setup.sh`, pick **AWS S3** at the storage prompt and paste:

| Wizard prompt | What to enter |
|---|---|
| S3 bucket name | The bucket name from step 1 |
| AWS region | The region code from step 1 (e.g. `us-east-1`) — must match exactly |
| AWS access key ID | The `AKIA…` value from step 5 |
| AWS secret access key | The secret from step 5 |

The wizard writes these into `.env`. To change them later without redoing the whole install, run `bash setup.sh --reconfigure`.

### Troubleshooting

- **`403 SignatureDoesNotMatch` on PUT from the browser** — the region in `.env` doesn't match the bucket's region, or the access keys are wrong. Check S3 → bucket → Properties → AWS Region and verify `AWS_DEFAULT_REGION` in `.env`.
- **`403` on HeadObject from the backend log** — IAM policy is missing or wrong. Usually caused by (a) clicking away before hitting "Create policy" so the policy never saved, or (b) writing `arn:aws:s3:::bucket` (no `/*`) as the resource for `GetObject`. Both of these produce 403 even if the upload succeeded.
- **`AccessDenied` with no clear cause** — the IAM user might have an explicit deny somewhere else (SCP from an AWS Organization, bucket policy, or another attached policy). Check the user's full set of permissions.
- **`CORS preflight` error in the browser console** — your browser's origin isn't in the bucket's `AllowedOrigins`. Copy whatever is in the address bar (exact scheme, host, and port) and add it.
- **Upload appears to succeed but processing 403s** — the file never made it to S3. Open DevTools → Network tab → find the `PUT` request → Response tab. The `<Code>` element in the XML body tells you exactly what S3 rejected.

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
