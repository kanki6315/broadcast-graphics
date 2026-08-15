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
  selectedCarIdx = null,
  onSelectCar,
}: {
  intelligence: RaceIntelligenceSnapshot | null | undefined;
  drivers: DriverState[];
  classId: number | "all";
  selectedCarIdx?: number | null;
  onSelectCar?: (carIdx: number) => void;
}) {
  const byCar = new Map(drivers.map((driver) => [driver.carIdx, driver]));
  const battles = (intelligence?.battles ?? [])
    .filter((battle) => classId === "all" || battle.classId === classId)
    .sort((left, right) => Number(!left.carIdxs.includes(selectedCarIdx ?? -1)) - Number(!right.carIdxs.includes(selectedCarIdx ?? -1)))
    .slice(0, 3);
  return (
    <section className="battle-watch" aria-label="Battle Watch">
      <header><strong>Battle Watch</strong><span>{battles.length > 0 ? `${battles.length} same-class` : "No clean candidates"}</span></header>
      <div>
        {battles.map((battle: BattleSummary) => {
          const [ahead, chasing] = battle.carIdxs.map((carIdx) => byCar.get(carIdx));
          const Tag = onSelectCar ? "button" : "div";
          return <Tag type={onSelectCar ? "button" : undefined} key={battle.id} className={`battle-watch-item${onSelectCar && battle.carIdxs.includes(selectedCarIdx ?? -1) ? " is-selected" : ""}`} disabled={onSelectCar ? !ahead || !chasing : undefined} onClick={onSelectCar ? () => chasing && onSelectCar(chasing.carIdx) : undefined} title={`${battle.quality} · ${battle.windowSeconds.toFixed(1)} second window`}>
            <span><b>#{ahead?.carNumber ?? "--"}</b><i /> <b>#{chasing?.carNumber ?? "--"}</b></span>
            <strong>{battle.currentGap == null ? "--" : `${battle.currentGap.toFixed(3)}s`}</strong>
            <small>{trendIcon(battle.direction)}{battle.direction ?? battle.quality}</small>
          </Tag>;
        })}
        {battles.length === 0 && <p>Waiting for a stable same-class gap window.</p>}
      </div>
    </section>
  );
}
