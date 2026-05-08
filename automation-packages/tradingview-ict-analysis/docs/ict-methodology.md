# Condensed ICT Methodology

Use this as a compact analysis guide for TradingView MCP workflows. It intentionally removes duplicated, broker-specific, and weak material from the source notes.

## Analysis Order

1. Identify the active symbol, timeframe, current price, session, and whether a major news window is active.
2. Build higher-timeframe bias from daily, 4H, and 1H structure.
3. Mark external liquidity: previous day high/low, previous week high/low, equal highs, equal lows, obvious swing highs, and obvious swing lows.
4. Mark internal liquidity and dealing range: current swing high to swing low, premium, equilibrium, and discount.
5. Look for liquidity sweep plus displacement.
6. Confirm market structure shift only when displacement breaks a meaningful swing and leaves an imbalance.
7. Prioritize entries from fair value gaps, order blocks, inverse fair value gaps, and OTE confluence.
8. Define invalidation before target planning.
9. Journal the setup even when no trade is valid.

## Core Concepts

Liquidity is the main driver. Treat obvious highs and lows as areas where stop orders may rest. A valid reversal idea usually needs a sweep of that liquidity, then displacement away from it.

Market structure defines permission. Long setups need bullish higher-timeframe structure or a valid bullish shift after sell-side liquidity is swept. Short setups need bearish higher-timeframe structure or a valid bearish shift after buy-side liquidity is swept.

Displacement is a strong directional candle or sequence that moves away from the swept level. It should break structure and create an imbalance. Weak drift is not enough.

## Fair Value Gap

A fair value gap is a three-candle imbalance created by displacement.

Bullish FVG:

- Candle 2 expands upward.
- Candle 3 low stays above Candle 1 high.
- The zone is Candle 1 high to Candle 3 low.

Bearish FVG:

- Candle 2 expands downward.
- Candle 3 high stays below Candle 1 low.
- The zone is Candle 3 high to Candle 1 low.

High-quality FVGs:

- Form after a liquidity sweep.
- Form during active session timing.
- Come from displacement that also creates MSS.
- Sit in discount for longs or premium for shorts.
- Remain partially unfilled before entry.

Low-quality FVGs:

- Form in chop.
- Are already fully mitigated.
- Sit against higher-timeframe bias.
- Have no nearby invalidation level.

## Order Block

An order block is the last opposing candle before displacement.

Bullish OB:

- Last bearish candle before bullish displacement.
- Prefer if price swept sell-side liquidity first.
- Invalidated if price closes below the OB low.

Bearish OB:

- Last bullish candle before bearish displacement.
- Prefer if price swept buy-side liquidity first.
- Invalidated if price closes above the OB high.

Use OBs as entry zones only when they align with liquidity, structure, and premium/discount. Do not treat every opposing candle as an order block.

## Inverse FVG And Breakers

An inverse FVG is a fully mitigated FVG that flips polarity after price accepts through it. Use it as support/resistance only after a clear close through the zone and a retest.

A breaker is a failed order block that flips direction after violation. Prefer breakers only when the failure happens with displacement and a clear liquidity context.

## OTE

OTE is the 62 percent to 79 percent retracement zone of the active dealing range, with 70 percent as the preferred midpoint. Use it as confluence, not as a standalone entry signal.

Longs prefer discount retracements into FVG/OB/IFVG confluence. Shorts prefer premium retracements into FVG/OB/IFVG confluence.

## Session Timing

Prefer active market windows where liquidity is available. Outside high-quality timing, produce analysis and staged plans instead of forcing entries.

Useful timing filters:

- London session and London close.
- New York AM session.
- Pre-session setup building without live entry.
- News blackout around high-impact events.

## Setup Quality

Required for a trade idea:

- Higher-timeframe bias or valid MSS.
- Liquidity sweep or clear draw on liquidity.
- Displacement.
- FVG, OB, IFVG, or breaker entry zone.
- Defined stop loss.
- Target at opposing liquidity.
- Reward:risk at least 3:1.

Bonus confluence:

- OTE alignment.
- Active session.
- Premium/discount alignment.
- Clean candle delivery with little overlap.
- Multiple-timeframe agreement.

Reject or mark "watch only" when:

- Price is mid-range with no premium/discount edge.
- No defined stop exists.
- Structure conflicts across timeframes.
- The only reason is an indicator signal.
- The setup requires chasing after displacement.

## TradingView MCP Data To Use

- `chart_get_state` first to identify symbol, timeframe, and visible studies.
- `data_get_ohlcv` with `summary=true` for multi-timeframe price context.
- `quote_get` for current price.
- `data_get_study_values` for visible study values.
- `data_get_pine_lines`, `data_get_pine_labels`, `data_get_pine_tables`, and `data_get_pine_boxes` when custom indicators expose levels.

## Output Format

Return:

- Symbol and timeframe.
- Current price and timestamp.
- Bias: bullish, bearish, neutral, or wait.
- Key liquidity above and below.
- Active dealing range and premium/discount state.
- FVG/OB/IFVG zones.
- Setup grade: A+, A, B, C, or no trade.
- Entry zone.
- Stop loss and invalidation.
- Targets.
- Reward:risk.
- News/session notes.
- Execution status: analysis only, paper/demo ready, or live approval required.
