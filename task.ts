import { Type, TSchema, Static } from '@sinclair/typebox';
import { Feature } from '@tak-ps/node-cot'
import type { Event } from '@tak-ps/etl';
import ETL, { SchemaType, handler as internal, local, DataFlowType, InvocationType } from '@tak-ps/etl';
import { fetch } from '@tak-ps/etl';

const InputSchema = Type.Object({
    'DEBUG': Type.Boolean({
        default: false,
        description: 'Print results in logs'
    })
});

const OutputSchema = Type.Object({
    route: Type.Optional(Type.String()),
    owner: Type.Optional(Type.String())
})

export default class Task extends ETL {
    static name = 'etl-cotrip-cameras';
    static flow = [ DataFlowType.Incoming ];
    static invocation = [ InvocationType.Schedule ];

    async schema(
        type: SchemaType = SchemaType.Input,
        flow: DataFlowType = DataFlowType.Incoming
    ): Promise<TSchema> {
        if (flow === DataFlowType.Incoming) {
            if (type === SchemaType.Input) {
                return InputSchema;
            } else {
                return OutputSchema;
            }
        } else {
            return Type.Object({});
        }
    }

    async control(): Promise<void> {
        await this.env(InputSchema);

        const features: Static<typeof Feature.InputFeature>[] = [];

        const res = await fetch('https://api-511x-co.carsprogram.org/cameras/map-features', {
            method: 'GET'
        });

        if (!res.ok) throw new Error('Error fetching Cameras');

        const body = await res.typed(Type.Object({
            features: Type.Array(Type.Object({
                type: Type.Literal('Feature'),
                geometry: Type.Object({
                    type: Type.Literal('Point'),
                    coordinates: Type.Array(Type.Number())
                }),
                properties: Type.Object({
                    id: Type.Union([Type.String(), Type.Number()]),
                    name: Type.String(),
                    tooltip: Type.Optional(Type.String()),
                    public: Type.Optional(Type.Boolean()),
                    route: Type.Optional(Type.String()),
                    cameraOwner: Type.Optional(Type.String()),
                    views: Type.Optional(Type.Array(Type.Object({
                        name: Type.Optional(Type.String()),
                        type: Type.String(),
                        url: Type.Optional(Type.String()),
                        broken: Type.Optional(Type.Boolean())
                    })))
                })
            }))
        }));

        for (const camera of body.features) {
            const id = String(camera.properties.id);
            const callsign = camera.properties.tooltip || camera.properties.name;

            if (camera.properties.public === false) {
                console.warn(`ok - skipping ${callsign} - not public`)
                continue;
            } else if (camera.geometry.coordinates.length < 2) {
                console.warn(`ok - skipping ${callsign} - invalid coordinates`)
                continue;
            } else if (camera.geometry.coordinates[0] === 0 && camera.geometry.coordinates[1] === 0) {
                console.warn(`ok - skipping ${callsign} - null island coordinates`)
                continue;
            }

            const view = (camera.properties.views || []).find((v) => {
                return v.type === 'WMP' && v.url && !v.broken;
            });

            if (!view || !view.url) {
                console.warn(`ok - skipping ${callsign} - missing streaming video`)
                continue;
            }

            features.push({
                id,
                type: 'Feature',
                properties: {
                    type: 'b-m-p-s-p-loc',
                    callsign,
                    sensor: {
                        hideFov: true
                    },
                    video: {
                        uid: id + '-video',
                        sensor: callsign,
                        url: view.url,
                        connection: {
                            networkTimeout: 12000,
                            uid: id + '-video',
                            path: "",
                            protocol: "raw",
                            bufferTime: -1,
                            address: view.url,
                            port: -1,
                            roverPort: -1,
                            rtspReliable: 0,
                            ignoreEmbeddedKLV: false,
                            alias: callsign
                        }
                    },
                    metadata: {
                        route: camera.properties.route,
                        owner: camera.properties.cameraOwner
                    }
                },
                geometry: camera.geometry
            })
        }

        const fc: Static<typeof Feature.InputFeatureCollection> = {
            type: 'FeatureCollection',
            features: features
        }

        await this.submit(fc);
    }
}

await local(await Task.init(import.meta.url), import.meta.url);
export async function handler(event: Event = {}) {
    return await internal(await Task.init(import.meta.url), event);
}

