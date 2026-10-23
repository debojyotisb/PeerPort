import { describe, it, expect, beforeEach } from 'vitest';
import { useConnectionStore } from '../state/connection-store.js';

describe('Connection Store & State Machine Transitions', () => {
  beforeEach(() => {
    useConnectionStore.getState().reset();
  });

  it('initializes in IDLE state', () => {
    const state = useConnectionStore.getState();
    expect(state.connectionState).toBe('IDLE');
    expect(state.role).toBeNull();
    expect(state.remoteDevice).toBeNull();
  });

  it('updates connection state correctly', () => {
    const store = useConnectionStore.getState();
    store.setConnectionState('CONNECTING');
    expect(useConnectionStore.getState().connectionState).toBe('CONNECTING');

    store.setConnectionState('AWAITING_APPROVAL');
    expect(useConnectionStore.getState().connectionState).toBe('AWAITING_APPROVAL');

    store.setConnectionState('TRANSFERRING');
    expect(useConnectionStore.getState().connectionState).toBe('TRANSFERRING');

    store.setConnectionState('COMPLETED');
    expect(useConnectionStore.getState().connectionState).toBe('COMPLETED');
  });

  it('records error message on failure', () => {
    const store = useConnectionStore.getState();
    store.setConnectionState('FAILED', 'ICE connection negotiation failed');
    const updated = useConnectionStore.getState();
    expect(updated.connectionState).toBe('FAILED');
    expect(updated.errorMessage).toBe('ICE connection negotiation failed');
  });

  it('resets cleanly back to IDLE', () => {
    const store = useConnectionStore.getState();
    store.setRole('SENDER');
    store.setRoomId('PP-9999');
    store.setConnectionState('TRANSFERRING');

    store.reset();
    const updated = useConnectionStore.getState();
    expect(updated.connectionState).toBe('IDLE');
    expect(updated.role).toBeNull();
    expect(updated.roomId).toBeNull();
    expect(updated.errorMessage).toBeNull();
  });
});
