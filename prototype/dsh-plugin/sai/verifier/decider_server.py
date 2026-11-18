"""Local verifier service for sAI: Perplexity Decider-Flash v1.3 (4B, Apache 2.0) decides whether a word is used as
a name in its text ("Reply to bill: …") or as an ordinary word ("… paid the bill."). sAI cuts each text so that the
word appears in it once.

The service listens on 127.0.0.1 only and never writes the texts it receives to a log.

  POST /verify  {"questions": [{"state": str, "word": str, "classId": str, "term": str}, ...]}
             -> {"probabilities": [float, ...]}     one P(name) per question, in order
  GET  /health  -> {"ok": true, "model": ...}

All the questions of one call go to the model in one decide() call. The Decider answers each question in its own
sequence (mode "separate"), so an answer never depends on the other questions of the call.

Run (Python 3.11, torch with CUDA, transformers, bitsandbytes):
  python -I decider_server.py --model "<folder of perplexity-ai/pplx-decider-flash-v1.3>" [--port 8765] [--cpu]

The model folder carries the Decider's own source (source/src/pplx_decider), which this script imports.
"""
import argparse
import json
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

MAX_BODY = 64 * 1024 * 1024
MAX_QUESTIONS = 5000
WHAT = {"PERSON": "a person's name", "COMPANY": "a company's name", "ORGANIZATION": "an organization's name"}


def question_text(word: str, class_id: str, term: str) -> str:
    """The question measured on the 822-case set. (Marking the word ⟪ ⟫ in the text made the answers worse.)"""
    what = WHAT.get(class_id, "a name")
    return f'In this text, is the word "{word}" used as {what} (like {term}), rather than as an ordinary word?'


class FileReader:
    """Reads safetensors tensors with plain seek/read, one at a time. Memory-mapping the 8 GB of shards fails on a
    computer short of commit memory (Windows error 1455); this needs one tensor's worth."""

    def __init__(self, folder: Path):
        import struct
        import torch
        self.dtypes = {"BF16": torch.bfloat16, "F16": torch.float16, "F32": torch.float32}
        self.where = {}
        for shard in sorted(set(json.loads((folder / "model.safetensors.index.json").read_text())["weight_map"].values())):
            with open(folder / shard, "rb") as f:
                size = struct.unpack("<Q", f.read(8))[0]
                header = json.loads(f.read(size))
            header.pop("__metadata__", None)
            for key, info in header.items():
                self.where[key] = (folder / shard, 8 + size, info)

    def get(self, key: str):
        import torch
        path, base, info = self.where[key]
        start, end = info["data_offsets"]
        data = torch.empty(end - start, dtype=torch.uint8)
        with open(path, "rb") as f:
            f.seek(base + start)
            if f.readinto(data.numpy()) != end - start:
                raise IOError(f"short read for {key}")
        return data.view(self.dtypes[info["dtype"]]).reshape(info["shape"])


def build_backbone_4bit(path: str):
    """Qwen3_5Model as from_pretrained(dtype=bf16, attn_implementation="sdpa") would build it, but filled one tensor
    at a time: every Linear becomes a 4-bit NF4 layer on the GPU, every other weight a bf16 tensor on the GPU, and the
    rotary tables (not in the checkpoint) are rebuilt from the config. The image tower is left out: sAI sends only
    text, and leaving it out keeps the load within a computer short of memory."""
    import bitsandbytes as bnb
    import torch
    from transformers.models.qwen3_5.modeling_qwen3_5 import Qwen3_5Config, Qwen3_5Model
    config = Qwen3_5Config.from_pretrained(path)
    for sub in (config, config.text_config, config.vision_config):
        sub._attn_implementation = "sdpa"
    with torch.device("meta"):
        model = Qwen3_5Model(config).to(torch.bfloat16)
    reader = FileReader(Path(path))

    def parent(name):
        head, _, leaf = name.rpartition(".")
        return (model.get_submodule(head) if head else model), leaf
    text = lambda name: not name.startswith("visual.")  # noqa: E731
    for name, linear in [(n, m) for n, m in model.named_modules() if isinstance(m, torch.nn.Linear) and text(n)]:
        layer = bnb.nn.Linear4bit(linear.in_features, linear.out_features, bias=linear.bias is not None,
                                  compute_dtype=torch.bfloat16, quant_type="nf4", device="meta")
        layer.weight = bnb.nn.Params4bit(reader.get(f"{name}.weight").to(torch.bfloat16), requires_grad=False, quant_type="nf4").cuda()
        if linear.bias is not None:
            layer.bias = torch.nn.Parameter(reader.get(f"{name}.bias").to("cuda", torch.bfloat16), requires_grad=False)
        module, leaf = parent(name)
        setattr(module, leaf, layer)
    for name, param in list(model.named_parameters()):
        if param.is_meta and text(name):
            module, leaf = parent(name)
            setattr(module, leaf, torch.nn.Parameter(reader.get(name).to("cuda", torch.bfloat16), requires_grad=False))
    for name, module in list(model.named_modules()):
        if text(name) and any(buffer.is_meta for buffer in module.buffers(recurse=False)):
            fresh = type(module)(module.config).to("cuda")  # the rotary embeddings: their tables come from the config
            owner, leaf = parent(name)
            setattr(owner, leaf, fresh)
    left = [n for n, t in list(model.named_parameters()) + list(model.named_buffers()) if t.is_meta and text(n)]
    if left:
        raise RuntimeError(f"tensors not loaded: {left[:5]} ({len(left)})")
    torch.cuda.empty_cache()
    return model.eval().requires_grad_(False)


def load_decider(folder: Path, cpu: bool, batch_tokens: int):
    """The Decider with its backbone in 4-bit NF4 on the GPU (bf16 does not fit 8 GB), or in its own way on the CPU."""
    sys.path.insert(0, str(folder / "source" / "src"))
    import pplx_decider.model as pm
    if cpu:
        return pm.Decider.from_pretrained(folder, device="cpu", batch_tokens=batch_tokens)
    from transformers.models.qwen3_5.modeling_qwen3_5 import Qwen3_5Model

    def quantized(path, **kwargs):  # the Decider's own call; its later .to(device) becomes a no-op
        model = build_backbone_4bit(path)
        model.to = lambda *a, **k: model
        return model
    Qwen3_5Model.from_pretrained = quantized
    return pm.Decider.from_pretrained(folder, device="cuda", batch_tokens=batch_tokens)


def parse(body: bytes) -> list[dict]:
    data = json.loads(body)
    questions = data.get("questions") if isinstance(data, dict) else None
    if not isinstance(questions, list) or len(questions) > MAX_QUESTIONS:
        raise ValueError("questions must be a list of at most %d items" % MAX_QUESTIONS)
    for q in questions:
        if not isinstance(q, dict) or not all(isinstance(q.get(k), str) for k in ("state", "word", "classId", "term")):
            raise ValueError("each question needs string fields state, word, classId, term")
    return questions


def make_handler(decider, model_name: str):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format, *args):  # noqa: A002  (no request lines: they are harmless, but keep logs quiet)
            pass

        def reply(self, status: int, payload: dict) -> None:
            body = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):  # noqa: N802
            if self.path == "/health":
                self.reply(200, {"ok": True, "model": model_name})
            else:
                self.reply(404, {"error": "not found"})

        def do_POST(self):  # noqa: N802
            if self.path != "/verify":
                return self.reply(404, {"error": "not found"})
            length = int(self.headers.get("content-length") or 0)
            if length <= 0 or length > MAX_BODY:
                return self.reply(413, {"error": "body too large or empty"})
            try:
                questions = parse(self.rfile.read(length))
            except (ValueError, json.JSONDecodeError) as error:
                return self.reply(400, {"error": str(error)})
            started = time.perf_counter()
            requests = [{"state": q["state"], "questions": {"q": {"type": "noul", "instructions": question_text(
                q["word"], q["classId"], q["term"])}}} for q in questions]
            try:
                answers = decider.decide(requests) if requests else []
            except Exception as error:  # noqa: BLE001  (the client masks every word when the call fails)
                import traceback  # code locations only: the frames never carry the texts
                frames = "".join(traceback.format_tb(error.__traceback__)[-4:])
                print(f"verify failed for {len(requests)} questions: {type(error).__name__}", flush=True)
                print(frames, flush=True)
                return self.reply(500, {"error": type(error).__name__})
            probabilities = [float(a["answers"]["q"]["noul"]) for a in answers]
            print(f"verify: {len(questions)} questions in {1000 * (time.perf_counter() - started):.0f} ms", flush=True)
            self.reply(200, {"probabilities": probabilities})
    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model", required=True, type=Path, help="folder of pplx-decider-flash-v1.3")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--cpu", action="store_true", help="run on the CPU (slow)")
    parser.add_argument("--batch-tokens", type=int, default=4096,
                        help="tokens per forward pass; the Decider's default (32768) does not fit an 8 GB GPU")
    args = parser.parse_args()
    started = time.perf_counter()
    decider = load_decider(args.model, args.cpu, args.batch_tokens)
    print(f"model loaded in {time.perf_counter() - started:.0f} s; listening on http://127.0.0.1:{args.port}", flush=True)
    HTTPServer(("127.0.0.1", args.port), make_handler(decider, args.model.name)).serve_forever()


if __name__ == "__main__":
    main()
