import debugpy
print("Connecting to debuggee...")
debugpy.connect(("127.0.0.1", 5678))
print("Connected OK!")

# Optional: wait so you can see it's attached
debugpy.wait_for_client()
print("Client stayed connected, exiting.")