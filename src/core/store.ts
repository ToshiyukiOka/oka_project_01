// OntologyStore — 保存の抽象。歩くスケルトンはローカル JSON 永続の InMemoryStore で動く。
// 本番は db/schema.sql (Postgres + AGE) 実装に差し替える（同インターフェース）。

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  OntologyObject,
  OntologyLink,
  ObjectKind,
  LinkKind,
  WeeklyCommit,
  ProposedAction,
  LineageRef,
  FactMeta,
} from '../ontology/types.ts';

export interface OntologyStore {
  addObject(
    kind: ObjectKind,
    props: Record<string, unknown>,
    opts?: { confidence?: number; sources?: LineageRef[] },
  ): OntologyObject;
  updateObject(id: string, patch: Partial<OntologyObject['props']>): void;
  getObjects(kind?: ObjectKind): OntologyObject[];
  getObject(id: string): OntologyObject | undefined;

  addLink(
    from: string,
    to: string,
    kind: LinkKind,
    opts?: { confidence?: number; sources?: LineageRef[] },
  ): OntologyLink;
  linksFrom(id: string, kind?: LinkKind): OntologyLink[];
  linksTo(id: string, kind?: LinkKind): OntologyLink[];

  addCommit(c: Omit<WeeklyCommit, 'id' | 'createdAt'>): WeeklyCommit;
  getCommits(): WeeklyCommit[];

  proposeAction(a: Omit<ProposedAction, 'id' | 'proposedAt' | 'state'>): ProposedAction;
  getActions(): ProposedAction[];

  markOpened(atISO: string): void;
  lastOpenedAt(): string | undefined;

  save(): void;
}

interface Snapshot {
  objects: OntologyObject[];
  links: OntologyLink[];
  commits: WeeklyCommit[];
  actions: ProposedAction[];
  lastOpenedAt?: string;
}

const now = () => new Date().toISOString();

export class InMemoryStore implements OntologyStore {
  private objects: OntologyObject[] = [];
  private links: OntologyLink[] = [];
  private commits: WeeklyCommit[] = [];
  private actions: ProposedAction[] = [];
  private _lastOpenedAt?: string;
  private readonly path?: string;

  constructor(path?: string) {
    this.path = path;
    if (path && existsSync(path)) {
      const s = JSON.parse(readFileSync(path, 'utf8')) as Snapshot;
      this.objects = s.objects ?? [];
      this.links = s.links ?? [];
      this.commits = s.commits ?? [];
      this.actions = s.actions ?? [];
      this._lastOpenedAt = s.lastOpenedAt;
    }
  }

  private meta(confidence?: number, sources?: LineageRef[]): FactMeta {
    const t = now();
    return {
      confidence: confidence ?? 0.6,
      sources: sources ?? [{ source: 'derived', at: t }],
      status: 'active',
      createdAt: t,
      updatedAt: t,
    };
  }

  addObject(kind: ObjectKind, props: Record<string, unknown>, opts = {}): OntologyObject {
    const obj: OntologyObject = {
      id: randomUUID(),
      kind,
      props,
      meta: this.meta(opts.confidence, opts.sources),
    };
    this.objects.push(obj);
    return obj;
  }

  updateObject(id: string, patch: Partial<OntologyObject['props']>): void {
    const o = this.objects.find((x) => x.id === id);
    if (!o) return;
    o.props = { ...o.props, ...patch };
    o.meta.updatedAt = now();
  }

  getObjects(kind?: ObjectKind): OntologyObject[] {
    return this.objects.filter((o) => o.meta.status === 'active' && (!kind || o.kind === kind));
  }

  getObject(id: string): OntologyObject | undefined {
    return this.objects.find((o) => o.id === id);
  }

  addLink(from: string, to: string, kind: LinkKind, opts = {}): OntologyLink {
    const link: OntologyLink = {
      id: randomUUID(),
      from,
      to,
      kind,
      meta: {
        confidence: opts.confidence ?? 0.6,
        sources: opts.sources ?? [{ source: 'derived', at: now() }],
        createdAt: now(),
      },
    };
    this.links.push(link);
    return link;
  }

  linksFrom(id: string, kind?: LinkKind): OntologyLink[] {
    return this.links.filter((l) => l.from === id && (!kind || l.kind === kind));
  }
  linksTo(id: string, kind?: LinkKind): OntologyLink[] {
    return this.links.filter((l) => l.to === id && (!kind || l.kind === kind));
  }

  addCommit(c: Omit<WeeklyCommit, 'id' | 'createdAt'>): WeeklyCommit {
    const commit: WeeklyCommit = { ...c, id: randomUUID(), createdAt: now() };
    this.commits.push(commit);
    return commit;
  }
  getCommits(): WeeklyCommit[] {
    return [...this.commits].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  }

  proposeAction(a: Omit<ProposedAction, 'id' | 'proposedAt' | 'state'>): ProposedAction {
    const action: ProposedAction = {
      ...a,
      id: randomUUID(),
      proposedAt: now(),
      state: 'proposed',
    };
    this.actions.push(action);
    return action;
  }
  getActions(): ProposedAction[] {
    return this.actions;
  }

  markOpened(atISO: string): void {
    this._lastOpenedAt = atISO;
  }
  lastOpenedAt(): string | undefined {
    return this._lastOpenedAt;
  }

  save(): void {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const snap: Snapshot = {
      objects: this.objects,
      links: this.links,
      commits: this.commits,
      actions: this.actions,
      lastOpenedAt: this._lastOpenedAt,
    };
    writeFileSync(this.path, JSON.stringify(snap, null, 2));
  }
}
