# Write Essay Guided Support generation

The generator consumes the authoritative prompt workbook, the existing question/sample JSON, and `The_Academic_Collocation_List.xlsx`. It writes a manifest plus hash-named packs to the requested output directory. `--template-only` is a deterministic dry run and is never a production publication authority.

```powershell
# Representative dry run (safe temporary output)
python -m scripts.write_essay_support.cli --ids 1,370 --template-only `
  --output-root tmp/write-essay-support-smoke

# Full deterministic source/contract coverage (test mode)
python -m scripts.write_essay_support.cli --template-only `
  --output-root tmp/write-essay-support-full-template

# Full three-model generation and independent audit
python -m scripts.write_essay_support.cli `
  --output-root "public/database/Write Essay/support/v1"

# Validate an existing manifest and every referenced pack
python -m scripts.write_essay_support.cli --validate-only `
  --output-root "public/database/Write Essay/support/v1"

# Resume, skipping already published questions
python -m scripts.write_essay_support.cli --resume `
  --output-root "public/database/Write Essay/support/v1"

# Explicitly rerun only quarantined questions; prior sidecars are retained
python -m scripts.write_essay_support.cli --quarantine-only `
  --output-root "public/database/Write Essay/support/v1"
```

Every model stage uses Ollama's JSON mode. The sidecar records independent raw artifacts, votes, debate history, revised decisions, and prior records for targeted reruns. A component that fails its initial majority audit is debated once; a debated revision must receive three fresh PASS votes or it is quarantined. The aggregate report is derived from all sidecars. Targeted reruns write `reports/rerun-*.json` and do not overwrite the full `report.json`.

Do not copy a `template_only_dry_run` output into the production support path. Publication requires the `ollama_three_model_audit` mode, all three levels, valid source and collocation hashes, zero quarantined questions, and a complete manifest. The current source audit identifies question 370 as invalid because the authoritative workbook has a blank prompt; it must be repaired in the source workbook before a 453-entry release can pass the gate.
