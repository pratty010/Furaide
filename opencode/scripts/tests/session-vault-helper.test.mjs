import { test, expect } from 'bun:test';
import { archiveSession, classifySearch, markDeleted, selectVisibleSessions } from '../session-vault.mjs';

const FIXTURE = {
  sessions: [
    { id: 'ses_1', title: 'Fix installer', workspace: '/a', status: 'active', updated_at: '2026-06-05T10:00:00.000Z' },
    { id: 'ses_2', title: 'Brand review', workspace: '/b', status: 'archived', updated_at: '2026-06-04T10:00:00.000Z' },
  ],
};

test('selectVisibleSessions sorts recent first', () => {
  expect(selectVisibleSessions(FIXTURE)[0].id).toBe('ses_1');
});

test('classifySearch filters by title and workspace', () => {
  const result = classifySearch(FIXTURE.sessions, 'installer');
  expect(result).toHaveLength(1);
  expect(result[0].id).toBe('ses_1');
});

test('archiveSession marks session archived and adds archive path', () => {
  const next = archiveSession(FIXTURE, 'ses_1', '/tmp/archive/ses_1.json');
  expect(next.sessions.find(session => session.id === 'ses_1')?.status).toBe('archived');
  expect(next.sessions.find(session => session.id === 'ses_1')?.archive_path).toBe('/tmp/archive/ses_1.json');
});

test('markDeleted marks session deleted without removing record', () => {
  const next = markDeleted(FIXTURE, 'ses_2');
  expect(next.sessions.find(session => session.id === 'ses_2')?.status).toBe('deleted');
});
