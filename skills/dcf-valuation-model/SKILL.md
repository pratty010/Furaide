---
name: dcf-valuation-model
description: Build and stress-test a Discounted Cash Flow valuation model for a public company or acquisition target. Use in Workflow #5 as a native fallback (when the external dcf-model skill is unavailable) to project cash flows, establish discount rates, and compute intrinsic value with sensitivity analysis.
---

# dcf-valuation-model

Build DCF models and conduct valuation sensitivity analysis.

## When to invoke

- Workflow #5 needs DCF valuation
- External `dcf-model` skill unavailable
- Need to value a public company or M&A target
- Should include forecast assumptions and sensitivity testing

## Model Components

1. **Revenue Forecast**: Project 5-10 year revenue based on historical trends and growth assumptions.
2. **Operating Margins**: Forecast EBITDA, operating income, and tax rates.
3. **Free Cash Flow**: Calculate FCF from operating income minus capex and working capital.
4. **Terminal Value**: Estimate perpetual-value growth or exit multiple.
5. **Discount Rate (WACC)**: Calculate weighted average cost of capital.
6. **Valuation**: Compute present value of projected cash flows.

## Phases

1. **Data Collection**: Gather historical financials, capital structure, industry comps.
2. **Assumption Building**: Document revenue growth, margin evolution, capex, tax rate.
3. **Forecast Build**: Project cash flows with explicit assumptions.
4. **Sensitivity Analysis**: Test valuation across bull/base/bear scenarios.
5. **Output**: Write to `research/financial/<company>-dcf-<date>.json` with full model.

## Rules

- Assumptions must be explicit and defensible; document sources.
- Sensitivity table should vary growth rate and discount rate across ±2-3% range.
- Terminal value assumptions (perpetuity growth or exit multiple) must be justified.
- Flag low-confidence assumptions and key risks to valuation.
