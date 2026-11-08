/** The spec a ticket names on its `Parent: #<n>` line, or `null` for none. */
export const parentIssue = (body: string): number | null => {
  const match = /^Parent:\s*#(\d+)\s*$/imu.exec(body);
  return match === null ? null : Number(match[1]);
};
