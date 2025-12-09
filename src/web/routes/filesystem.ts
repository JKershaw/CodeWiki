/**
 * Filesystem browsing routes.
 */

import { Router, type Request, type Response } from 'express';
import { resolve, join, dirname } from 'path';
import { readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import type { Dependencies } from './index.js';

/**
 * Create filesystem browsing routes.
 */
export function createFilesystemRoutes(_deps: Dependencies): Router {
  const router = Router();

  /**
   * @swagger
   * /filesystem/browse:
   *   get:
   *     summary: Browse filesystem directories
   *     tags: [Filesystem]
   *     parameters:
   *       - in: query
   *         name: path
   *         schema:
   *           type: string
   *         description: Directory path (defaults to home directory)
   *     responses:
   *       200:
   *         description: Directory listing
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 currentPath:
   *                   type: string
   *                   description: Absolute path of current directory
   *                 parent:
   *                   type: string
   *                   nullable: true
   *                   description: Parent directory path (null if at home or root)
   *                 directories:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/FileSystemEntry'
   *       400:
   *         description: Path is not a directory
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *       403:
   *         description: Access denied (outside home directory)
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *       500:
   *         description: Server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   */
  router.get('/api/filesystem/browse', async (req: Request, res: Response) => {
    try {
      const home = homedir();
      const requestedPath = (req.query.path as string) || home;
      const absolutePath = resolve(requestedPath);

      // Security: only allow browsing within home directory
      if (!absolutePath.startsWith(home) && absolutePath !== home) {
        res.status(403).json({ error: 'Access denied: can only browse within home directory' });
        return;
      }

      // Check if path exists and is a directory
      const pathStat = await stat(absolutePath);
      if (!pathStat.isDirectory()) {
        res.status(400).json({ error: 'Path is not a directory' });
        return;
      }

      // Read directory contents
      const entries = await readdir(absolutePath, { withFileTypes: true });

      // Filter to directories only and check for git repos
      const directories = entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => {
          const fullPath = join(absolutePath, entry.name);
          const isGitRepo = existsSync(join(fullPath, '.git'));
          return {
            name: entry.name,
            path: fullPath,
            isGitRepo,
          };
        })
        .sort((a, b) => {
          // Git repos first, then alphabetical
          if (a.isGitRepo !== b.isGitRepo) return a.isGitRepo ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

      // Get parent directory (null if at home or root)
      const parent = absolutePath === '/' || absolutePath === home ? null : dirname(absolutePath);

      res.json({
        currentPath: absolutePath,
        parent,
        directories,
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  return router;
}
