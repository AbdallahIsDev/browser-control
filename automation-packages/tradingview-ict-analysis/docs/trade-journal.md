# Trade Journal Template

Store journal entries under the Browser Control data home, for example:

`trades_journal/trades/YYYY-MM-DD/SYMBOL-HHMM.md`

## Required Fields

- Date and time.
- Symbol.
- Platform: TradingView, MT5, broker, paper, or demo.
- Mode: analysis only, paper/demo, or live approval required.
- Timeframes reviewed.
- Session and news state.
- Higher-timeframe bias.
- Dealing range high, low, equilibrium, premium, and discount.
- Liquidity above.
- Liquidity below.
- Sweep observed: yes or no.
- Displacement observed: yes or no.
- MSS observed: yes or no.
- Entry model: FVG, OB, IFVG, breaker, OTE confluence, or no trade.
- Entry zone.
- Stop loss and invalidation.
- Targets.
- Reward:risk.
- Position size or proposed risk.
- Approval status and approval text when live.
- Screenshot or TradingView evidence references.
- Outcome.
- Post-trade review.

## Entry Skeleton

```md
# SYMBOL ICT Plan - YYYY-MM-DD HH:MM

Mode:
Platform:
Timeframes:
Session:
News:

## Bias

## Liquidity

Above:
Below:

## Structure

Sweep:
Displacement:
MSS:
Premium/discount:

## Setup

Model:
Entry zone:
Stop:
Targets:
Reward:risk:
Risk:

## Execution

Status:
Approval:
Order id:

## Review

Outcome:
What worked:
What failed:
Next improvement:
```
