"""One-time authorized download; never called by the image API."""
import sys
import os
from huggingface_hub import HfApi, get_token, snapshot_download
from services.sam3_server import HF_REPO, HF_REVISION


def main():
    if not get_token():
        hf = r".venv-sam3\Scripts\hf" if os.name == "nt" else ".venv-sam3/bin/hf"
        print(f"Sign in first with {hf} auth login, then complete the browser authorization using the account with facebook/sam3 access.")
        return 1
    try:
        HfApi().auth_check(repo_id=HF_REPO, repo_type="model")
    except Exception:
        print("SAM 3 access could not be verified. Check your login, model approval and network connection.")
        return 1
    folder = snapshot_download(HF_REPO, revision=HF_REVISION, local_dir=os.environ.get('BANNERFLOW_SAM3_MODEL'),
                               allow_patterns=["*.json", "*.safetensors", "merges.txt"])
    print(f"SAM 3 model files are ready at {folder}")
    print("Use Check connection in the app. The first search loads the model.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
