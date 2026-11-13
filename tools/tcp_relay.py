#!/usr/bin/env python3
"""TCP relay for tools/validate_in_docker.sh --live-proxy: makes a proxy that listens on the host's loopback reachable
from containers, on the Docker bridge address only, for the duration of the check.

  python3 tcp_relay.py <listen host> <listen port> <target host> <target port>
"""
import asyncio
import sys


async def pipe(reader, writer):
    try:
        while data := await reader.read(65536):
            writer.write(data)
            await writer.drain()
    except (ConnectionError, asyncio.CancelledError):
        pass
    finally:
        writer.close()


async def main(listen_host, listen_port, target_host, target_port):
    async def handle(client_reader, client_writer):
        try:
            target_reader, target_writer = await asyncio.open_connection(target_host, target_port)
        except OSError:
            client_writer.close()
            return
        await asyncio.gather(pipe(client_reader, target_writer), pipe(target_reader, client_writer))

    server = await asyncio.start_server(handle, listen_host, listen_port)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], int(sys.argv[2]), sys.argv[3], int(sys.argv[4])))
