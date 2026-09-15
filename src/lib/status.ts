import type { OrderStatus } from '@/types';

export const orderStatusMeta: Record<
  OrderStatus,
  { label: string; color: string; bgColor: string; borderColor: string; dot: string }
> = {
  new: {
    label: 'New',
    color: 'text-warning-700',
    bgColor: 'bg-warning-50',
    borderColor: 'border-warning-500',
    dot: 'bg-warning-500',
  },
  preparing: {
    label: 'Preparing',
    color: 'text-error-700',
    bgColor: 'bg-error-50',
    borderColor: 'border-error-500',
    dot: 'bg-error-500',
  },
  ready: {
    label: 'Ready',
    color: 'text-success-700',
    bgColor: 'bg-success-50',
    borderColor: 'border-success-500',
    dot: 'bg-success-500',
  },
  served: {
    label: 'Served',
    color: 'text-ink-600',
    bgColor: 'bg-ink-100',
    borderColor: 'border-ink-400',
    dot: 'bg-ink-400',
  },
};

export const orderStatusFlow: OrderStatus[] = ['new', 'preparing', 'ready', 'served'];
