import { Container, Sprite, Text } from '@inlet/react-pixi'
import { TextStyle, Texture } from 'pixi.js'
import React, { useEffect, useState } from 'react'
import { useSelector } from 'react-redux';

export default function CountdownBoard(props) {
    const { endDate } = props
    const [end, setEnd] = useState(endDate)
    const [remainMin, setRemainMin] = useState(0)
    const [remainSec, setRemainSec] = useState(0)

    const ehh = Texture.from('../Images/game/characters/board.png');
    useEffect(() => {
        setEnd(endDate)
    }, [endDate])


    useEffect(() => {


        const target = new Date(end).getTime()
        const interval = setInterval(() => {

            const now = new Date().getTime()
            const distance = (target - now)
            const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((distance % (1000 * 60)) / 1000);
            setRemainMin(minutes)
            setRemainSec(seconds)

        }, 1000)
        return () => {
            clearInterval(interval)
        }

    }, [])
    function convert(n) {
        n = String(n)
        if (n.length == 1)
            n = '0' + n
        return n
    }

    return (
        <Container
            sortableChildren
        >

            <Container

                zIndex={0}
                scale={[1, 1.2]}
                anchor={0.5}
                x={0}
                y={-200}
            >


                <Text
                    zIndex={1}
                    text={`${convert(remainMin)} : ${convert(remainSec)}`.toUpperCase()} //  new Intl.NumberFormat('en-GB', { notation: 'compact' }).format(1190000)
                    anchor={0.5}
                    scale={{ x: 1, y: 1 }}
                    // skew={[0.6, -0.3]}
                    style={
                        new TextStyle({
                            // align: 'center',
                            // breakWords: true,
                            // trim: true,
                            // fontFamily: "'Nunoto', sans-serif",
                            // fontWeight: 700,
                            // fontSize: 40,
                            // letterSpacing: 0,
                            // fill: ['#000000'], // gradient
                            // stroke: '#ffffff',
                            // strokeThickness: 10,
                            // // dropShadow: true,
                            // // dropShadowColor: '#ccced2',
                            // // dropShadowBlur: 1,
                            // // dropShadowAngle: Math.PI / 6,
                            // // dropShadowDistance: 1,
                            // // wordWrap: true,
                            // // wordWrapWidth: 440,
                            align: 'center',
                            fontFamily: 'Arial',
                            fill: ['#000000'],
                            stroke: '#eeeeee',
                            fontSize: 22,
                            fontWeight: 'bold',
                            lineJoin: 'round',
                            strokeThickness: 4,
                            wordWrap: true,
                            wordWrapWidth: 150,
                            breakWords: false,
                            lineHeight: 30
                        })
                    }
                />
            </Container>
            <Sprite
                anchor={0.5}
                zIndex={-2}
                scale={0.1}
                x={0}
                y={-200}
                texture={ehh}
            />




        </Container>
    )
}
