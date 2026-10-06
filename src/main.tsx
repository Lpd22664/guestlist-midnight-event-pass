import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { GuestlistModes } from './live-app';
import { DemoService } from './demo-service';
import './styles.css';
const service = new DemoService();
service.initialise().then(() => createRoot(document.getElementById('root')!).render(<React.StrictMode><GuestlistModes demo={executionControls=><App service={service} executionControls={executionControls}/>}/></React.StrictMode>)).catch(() => { document.getElementById('root')!.innerHTML = '<main style="font:18px system-ui;padding:48px"><h1>Guestlist could not start</h1><p>Try a current browser with Web Crypto enabled, or open this app on localhost or HTTPS.</p></main>'; });
