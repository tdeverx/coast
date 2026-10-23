import { expect, test } from 'bun:test';
test('actual-data probes reject an unmarked ordinary database before connecting', async () => {
    for (const file of ['performance-followup.ts', 'performance-finalization.ts']) {
        const child = Bun.spawn([process.execPath, `scripts/${file}`], {
            env: { ...process.env, DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/coast', COAST_AUDIT_COPY_MARKER: '', COAST_AUDIT_IDENTITY_READ: '1' },
            stdout: 'pipe', stderr: 'pipe',
        });
        const [status, error] = await Promise.all([child.exited, new Response(child.stderr).text()]);
        expect(status).not.toBe(0);
        expect(error).toContain('disposable actual-data');
        expect(error).not.toContain('ECONNREFUSED');
    }
});
