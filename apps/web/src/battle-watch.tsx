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
}: {
  intelligence: RaceIntelligenceSnapshot | null | undefined;
  drivers: DriverState[];
  classId: number | "all";
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
          return <article className="battle-candidate" key={battle.id} title={`${battle.quality} · ${battle.windowSeconds.toFixed(1)} second window`}>
            <span className="battle-car-pair"><b>#{ahead?.carNumber ?? "--"}</b><i>vs</i><b>#{chasing?.carNumber ?? "--"}</b></span>
            <span className="battle-driver"><strong>{ahead?.name ?? "Car unavailable"}</strong><small>{ahead?.className ?? battle.className}</small></span>
            <span className="battle-driver"><strong>{chasing?.name ?? "Car unavailable"}</strong><small>{chasing?.className ?? battle.className}</small></span>
            <span className="battle-gap"><strong>{battle.currentGap == null ? "--" : `${battle.currentGap.toFixed(3)}s`}</strong><small>behind</small></span>
            <span className={`battle-trend trend-${battle.direction ?? "unknown"}`}>{trendIcon(battle.direction)}{battle.direction ?? battle.quality}</span>
          </article>;
        })}
        {battles.length === 0 && <p>Waiting for a stable same-class gap window.</p>}
      </div>
    </section>
  );
}
