import os
import asyncio

                                                                  
                                                                            
                                                                        
                                                            
try:
    if os.name == "nt":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
except Exception:
                                                                          
    pass

                                                                              
try:
    _pol = type(asyncio.get_event_loop_policy()).__name__
    print(f"[init] asyncio event loop policy: {_pol}")
except Exception:
    pass