"""[Codex] Benchmark evaluation harness and agreement measurement."""
import argparse
import json
import sys
from pathlib import Path
from typing import List, Dict, Any, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))
import organizer
from llm_client import ProviderError


def load_records(path: Path) -> List[Dict[str, Any]]:
    path = Path(path)
    records = []
    seen_ids = set()
    with open(path, "r", encoding="utf-8") as f:
        for line_num, line in enumerate(f, 1):
            if len(line) > 100000:
                raise ValueError(f"line size limit exceeded at line {line_num}")
            line = line.strip()
            if not line:
                continue
            record = json.loads(line)
            rec_id = str(record.get("id", ""))
            if not rec_id:
                raise ValueError(f"Missing id at line {line_num}")
            if rec_id in seen_ids:
                raise ValueError(f"Duplicate id: {rec_id}")
            seen_ids.add(rec_id)
            content = record.get("content", "")
            if not isinstance(content, str):
                raise ValueError(f"Invalid content type for record {rec_id}")
            records.append(record)
    return records


def measure(records: List[Dict[str, Any]], predictions: List[str]) -> Dict[str, Any]:
    n = len(records)
    if n == 0:
        return {"accuracy": 0, "gemini_gold_accuracy": 0, "gemini_agreement": 0, "relative_gold_accuracy": None}

    correct = 0
    gemini_correct = 0
    agreements = 0

    for rec, pred in zip(records, predictions):
        expected = rec.get("expected")
        gemini_label = rec.get("gemini_label")
        if pred == expected:
            correct += 1
        if gemini_label == expected:
            gemini_correct += 1
        if pred == gemini_label:
            agreements += 1

    accuracy = correct / n
    gemini_gold_accuracy = gemini_correct / n
    gemini_agreement = agreements / n
    relative_gold_accuracy = (accuracy / gemini_gold_accuracy) if gemini_gold_accuracy > 0 else None

    return {
        "accuracy": accuracy,
        "gemini_gold_accuracy": gemini_gold_accuracy,
        "gemini_agreement": gemini_agreement,
        "relative_gold_accuracy": relative_gold_accuracy
    }


def evaluate(records: List[Dict[str, Any]], provider: str = "rules", model: Optional[str] = None) -> Dict[str, Any]:
    results = []
    failures = 0
    correct = 0
    # [Codex] A benchmark must not inherit private course folders or routing
    # rules. Provider credentials remain resolved by the provider interface.
    config = {}
    config["llm_provider"] = provider
    config["use_rule_engine"] = (provider == "rules")
    if model:
        if provider == "gemini":
            config["gemini_model"] = model
        else:
            config["ollama_model"] = model

    for record in records:
        rec_config = dict(config)
        if "course_term" in record:
            rec_config["course_term"] = record["course_term"]
        fn = record.get("filename", "")
        title = record.get("title", "")
        mod = record.get("module", "")
        content = record.get("content", "")
        expected = record.get("expected")

        try:
            if provider == "rules":
                pred = organizer.classify_document(fn, title, mod, content, rec_config)
            else:
                pred = organizer.categorize_with_ai(
                    fn, title, "", rec_config, "TEST_COURSE", [], mod, extracted_content=content
                )
            results.append({"id": record.get("id"), "prediction": pred, "error": None})
            if pred == expected:
                correct += 1
        except ProviderError:
            failures += 1
            results.append({"id": record.get("id"), "prediction": None, "error": "provider_failure"})
        except Exception as e:
            failures += 1
            results.append({"id": record.get("id"), "prediction": None, "error": str(e)})

    n = len(records)
    acc = (correct / n) if n > 0 else 0
    return {
        "results": results,
        "failures": failures,
        "accuracy": acc
    }


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("corpus", type=str)
    parser.add_argument("--provider", type=str, default="rules", choices=["rules", "ollama", "gemini"])
    parser.add_argument("--model", type=str, default=None)
    parser.add_argument("--require-gemini-parity", action="store_true")
    args = parser.parse_args(argv)

    if args.require_gemini_parity:
        return 2

    if args.provider != "rules":
        return 2

    try:
        records = load_records(Path(args.corpus))
        res = evaluate(records, provider=args.provider, model=args.model)
        return 0 if res["failures"] == 0 else 1
    except Exception:
        return 1


if __name__ == "__main__":
    sys.exit(main())
