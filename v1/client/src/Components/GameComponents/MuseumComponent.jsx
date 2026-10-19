import { Container, Sprite, Text } from '@inlet/react-pixi';
import { ColorReplaceFilter } from 'pixi-filters';
import { TextStyle, Texture } from 'pixi.js';
import React, { useEffect, useState } from 'react'
import { GROUP_COLORS, PLAYER_COLORS } from '../../config';
import { GAME_CONFIG } from '../../gameConfig';
import calcPrice from '../../Utils/calcPrice';
import { addSelection, putDoublerTo, nextPlayer, setDiceRollValue, setSelectErasmus, setShowErasmus, setShowBuyPanel } from '../../Store/slices/gameStateSlice';
import _ from 'lodash';
import { Spring } from 'react-spring'
import { useSocket } from '../../Contexts/SocketContext';

export default function MuseumComponent(props) {
  const { id, fields, dispatch, players, currentPlayer, showDisabledFields, disabledFilter, selectedFilter, singleSelecting, multipleSelecting, selectedFields, onlyOwnField, selectDoubler, selectErasmus, showSell, RoundOnMe } = props
  const [ownerColor, setOwnerColor] = useState(fields[id].ownerColor)
  const [filters, setFilters] = useState([])
  const [selectable, setSelectable] = useState(false)
  const [isPointerDown, setIsPointerDown] = useState(false)
  const [price, setPrice] = useState(calcPrice(id, fields[id].level, fields))
  const [hasDoubler, setHasDoubler] = useState(fields[id].hasDoubler)
  const socket = useSocket()

  useEffect(() => {
    socket.off('select_field_res').on('select_field_res', (data) => { if (true) select(data) })
  })

  useEffect(() => {
    setOwnerColor(fields[id].ownerColor)
    setPrice(calcPrice(id, fields[id].level, fields))
    setHasDoubler(fields[id].hasDoubler)
  }, [fields])

  const label_bg = Texture.from('../Images/game/isometriccity/PNG/cityTiles_072.png');
  const museum = Texture.from('../Images/game/characters/museum.png');
  const doubler = Texture.from('../Images/game/characters/doubler.png');

  const formatter = new Intl.NumberFormat('en-GB', { notation: 'compact' })

  const colorFilter = new ColorReplaceFilter()
  const filterNeeded = fields[id].ownerColor !== null
  colorFilter.originalColor = 0xC2BEA8
  colorFilter.newColor = (filterNeeded) ? PLAYER_COLORS[fields[id].ownerColor].color : 0xfff
  colorFilter.epsilon = 0.05

  const HEIGHT = 96 / 2
  const BOTTOM_HEIGHT = 32
  const WIDTH = 129 / 2


  useEffect(() => {
    if (showDisabledFields) {
      if (onlyOwnField) {
        if (ownerColor === currentPlayer) {
          setSelectable(true)
          setFilters([])
        } else {
          setFilters([disabledFilter])
        }
      } else {

        if (ownerColor === null || ownerColor === currentPlayer) {
          setSelectable(true)
          setFilters([])
        } else {
          setFilters([disabledFilter])
        }
      }
    }

    return () => {
      setSelectable(false)
      setFilters([])

    }
  }, [showDisabledFields, currentPlayer])

  useEffect(() => {
    if (selectedFields.includes(id)) {
      filters.push(selectedFilter)
    } else {
      _.remove(filters, (n) => n === selectedFilter)
    }

    return () => {
      _.remove(filters, (n) => n === selectedFilter)
    }
  }, [selectedFields])


  const select = (id) => {
    if (RoundOnMe) emitSelect(id)
    if (multipleSelecting) {
      dispatch(addSelection(id))
    } else if (singleSelecting) {
      if (selectDoubler) {
        console.log('submit');
        dispatch(putDoublerTo(id))

        setTimeout(() => {
          dispatch(nextPlayer())
        }, 1000);
      } else if (selectErasmus) {

        let diff = id - players[currentPlayer].field % 32
        if (diff < 0) diff += 32
        dispatch(setDiceRollValue(diff))
        dispatch(setShowErasmus(false))
        dispatch(setSelectErasmus(false))
        dispatch(setShowBuyPanel(false))
      }

    }
  }
  const emitSelect = (id) => {
    socket.emit('select_field_req', id)
  }

  const pointerDown = (e) => {
    if (selectable && RoundOnMe) setIsPointerDown(true)
  }

  const pointerUp = (e) => {

    if (isPointerDown) {
      select(id)
    }
  }

  const pointerUpOutside = (e) => {
    if (RoundOnMe) setIsPointerDown(false)

  }

  const pointerCancel = (e) => {
    if (RoundOnMe) setIsPointerDown(false)
  }

  return (
    <Container
      sortableChildren
      anchor={0.5}
      scale={{ x: (props.flip ? -1 : 1) * GAME_CONFIG.scale, y: GAME_CONFIG.scale }}
      interactive={true}
      filters={filters}
      //pointerdown={(e) => e.currentTarget.y -= 10}
      //pointerup={(e) => e.currentTarget.y += 10}
      //pointerout={(e) => e.currentTarget.y += 10}
      pointerdown={pointerDown}
      pointerupoutside={pointerUpOutside}
      pointerup={pointerUp}
      pointercancel={pointerCancel}

      {...props}
      x={props.x}
      y={props.y - (selectable ? 15 : 0)}
    >
      <Container
        zIndex={90}
        scale={[1, 1.2]}
        rotation={Math.PI / 6.66667}
        anchor={0.5}
        x={-50}
        y={14}
      >


        <Text
          zIndex={90}
          text={props.label.toUpperCase()} //  new Intl.NumberFormat('en-GB', { notation: 'compact' }).format(1190000)
          anchor={0.5}
          skew={[-Math.PI / 4, 0]}
          scale={{ x: (props.flip ? -1 : 1) * 1, y: 1 }}
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

      <Container
        zIndex={90}
        scale={[1, 1.2]}
        rotation={Math.PI / 6.66667}
        anchor={0.5}
        x={-105}
        y={43}
      >


        <Text
          zIndex={90}
          text={(price.tandij) ? formatter.format(price.tandij) : ''} //  new Intl.NumberFormat('en-GB', { notation: 'compact' }).format(1190000)
          anchor={0.5}
          skew={[-Math.PI / 4, 0]}
          scale={{ x: (props.flip ? -1 : 1) * 1, y: 1 }}
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
              fontSize: 45,
              fontWeight: 'bold',
              lineJoin: 'round',
              strokeThickness: 4,
              wordWrap: true,
              wordWrapWidth: 150,
              breakWords: false,
              textBaseline: 'bottom',
              lineHeight: 30
            })
          }
        />
      </Container>


      <Sprite
        anchor={0.5}
        zIndex={2}
        scale={1}
        x={-WIDTH}
        y={+ HEIGHT + HEIGHT / 2}
        texture={label_bg}
        filters={[((props.groupId && filterNeeded) && colorFilter)]}
      />
      <Sprite
        anchor={0.5}
        zIndex={1}
        scale={1}
        x={-WIDTH * 2 + 1}
        y={-BOTTOM_HEIGHT + HEIGHT + HEIGHT / 2}
        texture={label_bg}
        filters={[((props.groupId && filterNeeded) && colorFilter)]}
      />

      <Sprite
        anchor={0.5}
        zIndex={0}
        scale={1}
        x={0}
        y={-BOTTOM_HEIGHT + HEIGHT + HEIGHT / 2}
        texture={label_bg}
      />
      <Sprite
        anchor={0.5}
        zIndex={-1}
        scale={1}
        x={-WIDTH}
        y={-BOTTOM_HEIGHT * 2 + HEIGHT + HEIGHT / 2}
        texture={label_bg}
      />

      <Sprite
        anchor={0.5}
        zIndex={-2}
        scale={1}
        x={0}
        y={-BOTTOM_HEIGHT * 3 + HEIGHT + HEIGHT / 2}
        texture={label_bg}
      />
      <Sprite
        anchor={0.5}
        zIndex={-1}
        scale={1}
        x={WIDTH}
        y={-BOTTOM_HEIGHT * 2 + HEIGHT + HEIGHT / 2}
        texture={label_bg}
      />
      <Sprite
        filters={[((filterNeeded) && colorFilter)]}
        anchor={0.5}
        zIndex={3}
        scale={0.26}
        x={WIDTH / 3}
        y={-HEIGHT * 1.27}
        texture={museum}
        pointerdown={pointerDown}
        pointerupoutside={pointerUpOutside}
        pointerup={pointerUp}
        pointercancel={pointerCancel}
      />
      {hasDoubler &&
        <Spring native from={{ x: WIDTH, y: -1000 }} to={{ x: WIDTH, y: -BOTTOM_HEIGHT * 5 }} >
          {props => (
            <Sprite
              anchor={0.5}
              zIndex={-5}
              scale={0.93}
              texture={doubler}
              {...props}
              x={WIDTH}
              y={-BOTTOM_HEIGHT * 5}
            />
          )}
        </Spring>

      }
    </Container>
  )
}
