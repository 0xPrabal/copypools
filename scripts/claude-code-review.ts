#!/usr/bin/env npx ts-node

/**
 * Claude Code Analyzer
 * Uses Claude API to analyze code for bugs, security issues, and improvements
 *
 * Usage:
 *   npx ts-node scripts/claude-code-review.ts [file|directory]
 *
 * Examples:
 *   npx ts-node scripts/claude-code-review.ts packages/backend/src/services/database.ts
 *   npx ts-node scripts/claude-code-review.ts packages/frontend/src/hooks
 *   npx ts-node scripts/claude-code-review.ts --changed  # Only analyze git changed files
 */

import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const client = new Anthropic();

interface AnalysisResult {
  file: string;
  issues: {
    severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
    type: 'bug' | 'security' | 'performance' | 'style' | 'improvement';
    line?: number;
    message: string;
    suggestion?: string;
  }[];
  summary: string;
}

const SYSTEM_PROMPT = `You are an expert code reviewer specializing in TypeScript, React, Node.js, and blockchain/Web3 development.

Analyze the provided code and identify:

1. **Bugs**: Logic errors, race conditions, null/undefined issues, type errors
2. **Security Issues**: SQL injection, XSS, secrets exposure, unsafe operations, improper validation
3. **Performance**: Memory leaks, inefficient algorithms, unnecessary re-renders, N+1 queries
4. **Best Practices**: Code smells, missing error handling, poor naming, lack of types

For each issue found, provide:
- Severity: critical, high, medium, low, or info
- Type: bug, security, performance, style, or improvement
- Line number (if identifiable)
- Clear description of the problem
- Suggested fix

Respond in JSON format:
{
  "issues": [
    {
      "severity": "high",
      "type": "security",
      "line": 42,
      "message": "SQL injection vulnerability - user input not sanitized",
      "suggestion": "Use parameterized queries instead of string concatenation"
    }
  ],
  "summary": "Brief overall assessment of the code quality"
}

Be thorough but avoid false positives. Focus on real issues that could cause problems in production.`;

async function analyzeFile(filePath: string): Promise<AnalysisResult> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const relativePath = path.relative(process.cwd(), filePath);

  // Skip very large files
  if (content.length > 50000) {
    return {
      file: relativePath,
      issues: [{
        severity: 'info',
        type: 'improvement',
        message: 'File too large for analysis (>50KB)',
      }],
      summary: 'Skipped - file too large'
    };
  }

  console.log(`\n🔍 Analyzing: ${relativePath}`);

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Analyze this ${path.extname(filePath)} file:\n\nFile: ${relativePath}\n\n\`\`\`${path.extname(filePath).slice(1)}\n${content}\n\`\`\``
        }
      ]
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        file: relativePath,
        issues: [],
        summary: 'Could not parse analysis results'
      };
    }

    const result = JSON.parse(jsonMatch[0]);
    return {
      file: relativePath,
      issues: result.issues || [],
      summary: result.summary || 'No summary provided'
    };
  } catch (error) {
    console.error(`Error analyzing ${relativePath}:`, error);
    return {
      file: relativePath,
      issues: [{
        severity: 'info',
        type: 'improvement',
        message: `Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      }],
      summary: 'Analysis failed'
    };
  }
}

function getFilesToAnalyze(target: string): string[] {
  if (target === '--changed') {
    // Get changed files from git
    const validExtensions = ['.ts', '.tsx', '.sol'];
    const isValidFile = (f: string) => validExtensions.some(ext => f.endsWith(ext));
    try {
      const output = execSync('git diff --name-only HEAD~1 HEAD', { encoding: 'utf-8' });
      return output
        .split('\n')
        .filter(isValidFile)
        .filter(f => fs.existsSync(f));
    } catch {
      // If git fails, get staged + unstaged changes
      const output = execSync('git diff --name-only && git diff --staged --name-only', { encoding: 'utf-8' });
      return [...new Set(output
        .split('\n')
        .filter(isValidFile)
        .filter(f => fs.existsSync(f)))];
    }
  }

  const stat = fs.statSync(target);

  if (stat.isFile()) {
    return [target];
  }

  if (stat.isDirectory()) {
    const files: string[] = [];
    // Directories to skip (including external libraries)
    const skipDirs = [
      'node_modules',
      '.next',
      'dist',
      '.git',
      'lib',           // Foundry external libraries
      'cache',         // Foundry cache
      'out',           // Foundry build output
      'broadcast',     // Foundry broadcast files
      '.ponder',       // Ponder cache
      'generated',     // Generated files
    ];
    const walk = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!skipDirs.includes(entry.name)) {
            walk(fullPath);
          }
        } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') || entry.name.endsWith('.sol')) {
          // Skip test files and mocks
          if (!entry.name.includes('.t.sol') && !entry.name.includes('Mock')) {
            files.push(fullPath);
          }
        }
      }
    };
    walk(target);
    return files;
  }

  return [];
}

function formatResults(results: AnalysisResult[]): void {
  const severityColors: Record<string, string> = {
    critical: '\x1b[41m\x1b[37m', // Red bg
    high: '\x1b[31m',             // Red
    medium: '\x1b[33m',           // Yellow
    low: '\x1b[36m',              // Cyan
    info: '\x1b[90m',             // Gray
  };
  const reset = '\x1b[0m';

  let totalIssues = 0;
  const issueCounts: Record<string, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0
  };

  console.log('\n' + '='.repeat(80));
  console.log('📊 CLAUDE CODE ANALYSIS REPORT');
  console.log('='.repeat(80));

  for (const result of results) {
    if (result.issues.length === 0) continue;

    console.log(`\n📁 ${result.file}`);
    console.log(`   Summary: ${result.summary}`);
    console.log('');

    for (const issue of result.issues) {
      totalIssues++;
      issueCounts[issue.severity]++;

      const color = severityColors[issue.severity] || '';
      const lineInfo = issue.line ? `Line ${issue.line}: ` : '';

      console.log(`   ${color}[${issue.severity.toUpperCase()}]${reset} ${issue.type}`);
      console.log(`   ${lineInfo}${issue.message}`);
      if (issue.suggestion) {
        console.log(`   💡 ${issue.suggestion}`);
      }
      console.log('');
    }
  }

  console.log('='.repeat(80));
  console.log('📈 SUMMARY');
  console.log('='.repeat(80));
  console.log(`Files analyzed: ${results.length}`);
  console.log(`Total issues: ${totalIssues}`);
  console.log(`  🔴 Critical: ${issueCounts.critical}`);
  console.log(`  🟠 High: ${issueCounts.high}`);
  console.log(`  🟡 Medium: ${issueCounts.medium}`);
  console.log(`  🔵 Low: ${issueCounts.low}`);
  console.log(`  ⚪ Info: ${issueCounts.info}`);
  console.log('='.repeat(80));

  // Exit with error code if critical/high issues found
  if (issueCounts.critical > 0 || issueCounts.high > 0) {
    process.exit(1);
  }
}

async function main() {
  const target = process.argv[2] || 'packages';

  console.log('🤖 Claude Code Analyzer');
  console.log('========================');

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY environment variable not set');
    console.log('   Set it with: export ANTHROPIC_API_KEY=your-api-key');
    process.exit(1);
  }

  const files = getFilesToAnalyze(target);

  if (files.length === 0) {
    console.log('No TypeScript files found to analyze');
    process.exit(0);
  }

  console.log(`Found ${files.length} files to analyze`);

  const results: AnalysisResult[] = [];

  // Analyze files with rate limiting (to avoid API limits)
  for (const file of files) {
    const result = await analyzeFile(file);
    results.push(result);

    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  formatResults(results);
}

main().catch(console.error);
