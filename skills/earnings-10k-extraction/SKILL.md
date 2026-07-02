---
name: earnings-10k-extraction
description: Extract key metrics, narratives, and risk factors from SEC 10-K filings and earnings reports. Use in Workflow #5 as a native fallback (when the external financial-statements skill is unavailable) to harvest structured financial data and qualitative insights from public-company disclosures.
---

# earnings-10k-extraction

Harvest financial data and narratives from SEC filings and earnings reports.

## When to invoke

- Workflow #5 needs to extract 10-K data
- External `financial-statements` skill unavailable
- Need both quantitative metrics and qualitative management commentary
- Should capture forward-looking statements and risk disclosure

## Extraction Categories

1. **Income Statement**: Revenue, operating income, net income trends.
2. **Balance Sheet**: Assets, liabilities, equity components.
3. **Cash Flow**: Operating, investing, financing cash flows.
4. **Management Commentary**: Strategy, market conditions, guidance.
5. **Risk Factors**: Identified risks and competitive pressures.
6. **Forward Guidance**: Management's expectations and assumptions.

## Phases

1. **Source Identification**: Locate 10-K/10-Q filings via SEC EDGAR or company IR.
2. **Data Extraction**: Parse tables and narratives; normalize into structured format.
3. **Metadata**: Capture fiscal period, filing date, and comparison years.
4. **Output**: Write to `research/financial/<company>-<year>-10k-extract.json`.

## Rules

- Use official SEC filings as primary source; cross-check with earnings transcripts.
- Preserve original formatting and units; normalize only in calculated metrics.
- Flag contingent or conditional statements; don't hide caveats.
