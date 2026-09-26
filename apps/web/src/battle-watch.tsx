import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import type { BattleSummary, DriverState, GapTrend, RaceIntelligenceSnapshot } from "@racecontrol/protocol";
import React from "react";

function trendIcon(direction: GapTrend["direction"]) {
  if (direction === "closing") return <ArrowDownRight aria-hidden="true" />;
  if (direction === "opening") return <ArrowUpRight aria-hidden="true" />;
  return <ArrowRight aria-hidden="true" />;
}

export function BattleWatch({
  intelligence,
  drivers,
  classId,
  onSelectBattle,
}: {
  intelligence: RaceIntelligenceSnapshot | null | undefined;
  drivers: DriverState[];
  classId: number | "all";
  onSelectBattle?: (ahead: number, chasing: number) => void;
}) {
  const byCar = new Map(drivers.map((driver) => [driver.carIdx, driver]));
  const battles = (intelligence?.battles ?? [])
    .filter((battle) => classId === "all" || battle.classId === classId)
    .slice(0, 3);
  return (
    <section className="battle-watch" aria-label="Battle Watch">
      <header><strong>Battle Watch</strong><span>{battles.length > 0 ? `${battles.length} live candidate${battles.length === 1 ? "" : "s"}` : "No clean candidates"}</span></header>
      <div>
        {battles.map((battle: BattleSummary) => {
          const [ahead, chasing] = battle.carIdxs.map((carIdx) => byCar.get(carIdx));
          return <article className="battle-candidate" key={battle.id}>
            <button className="battle-position-pair" disabled={!ahead || !chasing} onClick={() => ahead && chasing && onSelectBattle?.(ahead.carIdx, chasing.carIdx)}>
              <span>{battle.className}</span><strong>P{ahead?.classPosition ?? "—"}–P{chasing?.classPosition ?? "—"}</strong>
              <span className={`battle-trend trend-${battle.direction ?? "unknown"}`}>{trendIcon(battle.direction)}{battle.direction ?? "Watching"}</span>
            </button>
            <details><summary>Evidence</summary><p>#{ahead?.carNumber} {ahead?.name} / #{chasing?.carNumber} {chasing?.name} · {battle.currentGap?.toFixed(3) ?? "—"}s · {battle.quality} · {battle.windowSeconds.toFixed(1)} second window</p></details>
          </article>;
        })}
        {battles.length === 0 && <p>Waiting for a stable same-class gap window.</p>}
      </div>
    </section>
  );
}
