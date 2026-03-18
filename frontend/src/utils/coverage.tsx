import React from 'react';
import { Badge } from 'react-bootstrap';

export const getCoverageColor = (coverage: number): string => {
  if (coverage >= 80) return 'success';
  if (coverage >= 60) return 'warning';
  return 'danger';
};

export const getCoverageBadge = (coverage: number): JSX.Element => {
  const color = getCoverageColor(coverage);
  return <Badge bg={color}>{coverage.toFixed(1)}%</Badge>;
};

export const getPlatformBadge = (platform: string): JSX.Element => {
  const configs: Record<string, { bg: string; icon: string; label: string }> = {
    ios: { bg: 'dark', icon: 'bi-apple', label: 'iOS' },
    python: { bg: 'info', icon: 'bi-filetype-py', label: 'Python' },
    android: { bg: 'success', icon: 'bi-phone', label: 'Android' },
  };
  const c = configs[platform] || configs.android;
  return (
    <Badge bg={c.bg}>
      <i className={`bi ${c.icon} me-1`}></i>{c.label}
    </Badge>
  );
};
